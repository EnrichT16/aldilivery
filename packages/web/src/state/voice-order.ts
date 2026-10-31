import { useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  allowanceExtraPence,
  allowanceWords,
  chargeMomentWords,
  checkSchedule,
  dayWords,
  deliveryFeePence,
  itemChargesForLines,
  overOneRunnerWords,
  parseSpokenSchedule,
  preferredRankingWords,
  RESTAURANT_MIXED_WORDS,
  restaurantFeePence,
  restaurantMinimumWords,
  scheduleAgreementWords,
  ukDay,
  type DeliveryWindow,
} from '@aldilivery/core';

import { storeConfig } from '../config';
import {
  askOzi,
  createOrder,
  fetchMyArea,
  fetchShops,
  listPaymentMethods,
  markAreaWarned,
  priceBasketRemotely,
  recordCheckoutViewed,
  recordExchange,
  searchCatalogue,
  suggestItem,
  type CatalogueItem,
  type ItemSuggestion,
  type ExchangeBrain,
  type ExchangeOutcome,
  type OziUnderstanding,
} from '../lib/api';
import { currentAsker } from '../lib/ozi-asker';
import { money, sellable, shownPrice, tooDearWords } from '../lib/money';
import { completeBankCheck } from '../lib/stripe';
import { parseChoice, parseQuantity, parseYesNo, splitItems, wantsToStop } from '../voice/ordering';
import type { SpeakOutcome } from '../voice';
import { useBasket } from './basket';
import { useSession } from './session';
import { NAME_PATTERN, nameHeardIn } from '../voice/name';
import {
  findSmallTalk,
  looksLikeChatter,
  quietSpell,
  smallTalk,
  smallTalkReply,
} from '../voice/small-talk';

/**
 * Ordering by voice alone (docs/BUILD_PROMPT.md, Section E), as a conversation:
 *
 *   "I'd like bananas, grapes and milk."
 *   Ozi asks which, where there is more than one kind, and how many of each.
 *   Ozi reads the basket back, with the shopping, the delivery fee and the total.
 *   Ozi says the delivery address aloud — the registered home address, always, for a voice
 *   order — and waits for a yes (Section D).
 *   Where their area has no Runner (driver) yet, or is paused, Ozi says so gently and asks
 *   whether they would still like to go ahead (30 October 2026). It never stops the order.
 *   Ozi asks to send it and charge the card. A yes sends it.
 *
 * Two separate yeses, the address and the payment, and nothing is ever sent without both.
 * Above the voice ceiling (£80 by default) a voice yes is not enough: Ozi opens the
 * confirmation screen for a touch instead. The server enforces both limits as well, so nothing
 * here can get round them. "Stop" or "cancel" ends it at any point, with nothing sent.
 *
 * Until shop listings are built there is one listed shop; asked for another, Ozi says which it
 * is using.
 */

type Stage =
  | { kind: 'idle' }
  | { kind: 'choosing'; name: string; options: CatalogueItem[]; quantity: number | null }
  | { kind: 'quantity'; product: CatalogueItem; retried: boolean }
  | {
      kind: 'address';
      lines: OrderLine[];
      totalPence: number;
      home: string;
      cardId: string;
      lastFour: string;
      /** What was said, for the checkout insights (30 October 2026). */
      breakdown?: SaidBreakdown;
    }
  | {
      kind: 'payment';
      lines: OrderLine[];
      totalPence: number;
      home: string;
      cardId: string;
      lastFour: string;
      statement: string;
      /** Booked for a later day (ruling 78), as it was said: "deliver it on Saturday morning". */
      booking?: VoiceBooking;
    };

/** The figures Ozi said before the yes: the shopping, the item charges, delivery or the restaurant fee. */
interface SaidBreakdown {
  goodsPence: number;
  itemChargesPence: number;
  feePence: number;
  restaurant: boolean;
}

/** A later day, its window, and, if said, when the money is taken (ruling 78). */
interface VoiceBooking {
  deliveryDay: string;
  window: DeliveryWindow;
  chargeDay?: string;
  chargeTime?: string;
}

/** Said after the payment question: how to have it brought another day (ruling 78). */
const ANOTHER_DAY = 'To have it on another day, say the day, like deliver it on Saturday morning.';

/**
 * The question the one yes answers. For a booked order it says the day and window, when the
 * money is taken, and that the till on the day settles the final amount (ruling 78).
 */
function paymentQuestion(totalPence: number, lastFour: string, booking?: VoiceBooking): string {
  if (!booking) {
    return `Shall I send your order and pay now, charging about ${money(totalPence)} to your card ending ${lastFour}? You pay what the till says.`;
  }
  const settings = storeConfig.scheduled;
  const chargeTime = booking.chargeTime ?? settings.defaultChargeTime;
  const later = Boolean(booking.chargeDay);
  const paying = later
    ? `taking about ${money(totalPence)} from your card ending ${lastFour} ${chargeMomentWords(booking.chargeDay ?? booking.deliveryDay, chargeTime)}`
    : `and pay now, charging about ${money(totalPence)} to your card ending ${lastFour}`;
  return `Shall I send your order for ${dayWords(booking.deliveryDay)}, in the ${booking.window}, ${paying}? ${scheduleAgreementWords(
    {
      deliveryDay: booking.deliveryDay,
      window: booking.window,
      chargePlan: later ? 'scheduled' : 'now',
      chargeDay: booking.chargeDay,
      chargeTime,
    },
    settings,
  )}`;
}

/** One line of the order as it will be sent: the whole basket, not only what was just said. */
interface OrderLine {
  catalogueItemId: string;
  quantity: number;
}

interface Picked {
  product: CatalogueItem;
  quantity: number;
}

/** How long the words after "What would you like?" count as an order, whatever they are. */
export const EXPECT_ORDER_MS = 30_000;

const ORDER_INTENT =
  /\b(order|want|like|need|get|buy|have|bring|send|shopping|basket|grab|pick up|purchase|fetch|add|run out|ran out)\b/i;
/** "open X", "show me X", "go to X". */
const OPEN_SHOP = /^(?:please\s+)?(?:open|show me|go to|take me to)\s+(.{2,60})$/i;
/** How long the app waits for something not in the list to be looked up. */
const SUGGEST_WAIT_MS = 6000;
/** How long the app waits for the server's phrase book and the language model before going on alone. */
const ASK_WAIT_MS = 8000;
/**
 * A sentence the parser would chop badly, so the language model hears it whole (ruling 69): a reason
 * given ("I've run out of"), a request wrapped in politeness, or a long sentence.
 */
function needsEars(text: string): boolean {
  if (
    /\b(recommend|suggest|idea|ideas|what should i (have|eat|cook|make)|what('s| is) the (time|date|day)|what time)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  return (
    /\b(run out|ran out|because|i've|i have|could you|would you|can you|for me|please)\b/i.test(
      text,
    ) || text.trim().split(/\s+/).length > 9
  );
}

/** "two bananas" asks for two; "bananas" asks for some. */
function leadingQuantity(term: string): { quantity: number | null; name: string } {
  const match = term.match(
    /^(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a dozen|dozen)\s+(.+)$/i,
  );
  if (!match) return { quantity: null, name: term };
  const quantity = parseQuantity(match[1] as string);
  // "a" alone is "some", not a firm one: ask.
  return {
    quantity: /^an?$/i.test(match[1] as string) ? null : quantity,
    name: (match[2] as string).trim(),
  };
}

export interface VoiceOrdering {
  /** Whether a conversation about an order is under way. */
  busy: () => boolean;
  /** The next words should be taken as an order, whatever they are: Ozi has just asked. */
  expectOrder: () => void;
  /** Handle words Ozi heard. True when they were about ordering. */
  handle: (text: string) => Promise<boolean>;
  /**
   * "Send my order" (16 October 2026): the basket as it stands, read back whole with the total,
   * then the same two yeses as an order spoken from scratch, the address and the payment.
   */
  sendBasket: () => Promise<void>;
}

export function useVoiceOrdering(
  speak: (text: string) => Promise<SpeakOutcome>,
  /** No account yet: Ozi asks whether to open one now, by talking. */
  offerAccount?: () => void,
  /** Shows "One moment" while the server works out an answer (31 October 2026). */
  think: <T>(work: Promise<T>) => Promise<T> = (work) => work,
): VoiceOrdering {
  const { shopper, refresh } = useSession();
  // Ozi's memory (ruling 68): everything said here is kept with the words it answered, which
  // part of Ozi decided, and how it went. Recording never waits and never fails the talking.
  const lastHeard = useRef('');
  const turn = useRef(0);
  const note = useRef<{ brain: ExchangeBrain; outcome: ExchangeOutcome }>({
    brain: 'flow',
    outcome: 'asked',
  });
  const say = useCallback(
    async (text: string): Promise<SpeakOutcome> => {
      const outcome = await speak(text);
      recordExchange(
        {
          heard: lastHeard.current,
          said: text,
          brain: note.current.brain,
          outcome: note.current.outcome,
          turn: turn.current,
        },
        currentAsker(),
      );
      turn.current += 1;
      note.current = { brain: 'flow', outcome: 'asked' };
      return outcome;
    },
    [speak],
  );
  const basket = useBasket();
  const navigate = useNavigate();
  const shop = storeConfig.store.displayName;
  const { maximumOrderGoodsPence } = storeConfig.fees;
  const ceiling = storeConfig.voice.paymentCeilingPence;

  const stage = useRef<Stage>({ kind: 'idle' });
  const pending = useRef<string[]>([]);
  const picked = useRef<Picked[]>([]);
  // Straight after Ozi asks "What would you like?", the next words are an order, whatever they
  // are — but only for a short while. After that, only words that ask for something, or say
  // Ozi's name, start one: a conversation in the room is not an order.
  const expectingUntil = useRef<number | null>(null);
  const expectNow = (): void => {
    expectingUntil.current = Date.now() + EXPECT_ORDER_MS;
  };
  const isExpecting = (): boolean =>
    expectingUntil.current !== null && Date.now() <= expectingUntil.current;
  // Read through refs so the conversation always sees the current account and basket.
  const live = useRef({ shopper, basket });
  live.current = { shopper, basket };
  // Small talk and chatter while shopping (ruling 66): replies taken in turn, and the quiet
  // spell after Ozi's one gentle line.
  const chatterTurn = useRef(0);
  const quiet = useRef(quietSpell());

  /** Whether anything asked for is in the shop: a product Ozi has never heard of is still shopping. */
  const anyInCatalogue = useCallback(async (items: string[]): Promise<boolean> => {
    for (const term of items.slice(0, 3)) {
      try {
        const { items: found } = await searchCatalogue(leadingQuantity(term).name);
        if (found.some((option) => sellable(option.estimatedPricePence))) return true;
      } catch {
        // The shop list cannot be reached: nothing to match, so the words are taken as said.
      }
    }
    return false;
  }, []);

  // Things the language model recommended, waiting for a yes (19 October 2026).
  const offered = useRef<string[] | null>(null);
  // What the language model heard in the last sentence, when the parser saw nothing (ruling 69).
  const heardItems = useRef<OziUnderstanding | null>(null);

  /** The server's phrase book, then the language model, for a sentence looked within (rulings 49, 69). */
  const askWithin = useCallback(
    async (
      text: string,
    ): Promise<{ reply: string | null; understood?: OziUnderstanding } | null> => {
      const basket = live.current.basket.lines.map((line) => line.item.name);
      try {
        return await think(
          Promise.race([
            askOzi(text, 'within', chatterTurn.current, currentAsker(), basket),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), ASK_WAIT_MS)),
          ]),
        );
      } catch {
        return null;
      }
    },
    [think],
  );

  /**
   * Words that are not shopping (ruling 66). Small talk gets its warm reply. Anything else
   * shaped like a sentence to a person is sent to the server once, which answers it if it is
   * an everyday phrase and otherwise keeps it for the Learning list; Ozi then says one gentle
   * line and stays quiet for more chatter in the next twenty seconds. True when handled.
   */
  const chatter = useCallback(
    async (text: string, items: string[]): Promise<boolean> => {
      const small = findSmallTalk(text);
      if (small) {
        note.current = { brain: 'small-talk', outcome: 'answered' };
        await say(smallTalkReply(small, chatterTurn.current));
        chatterTurn.current += 1;
        return true;
      }
      if (!looksLikeChatter(text) || (await anyInCatalogue(items))) return false;
      const answer = await askWithin(text);
      chatterTurn.current += 1;
      // "Recommend a breakfast" (19 October 2026): the idea is said, and its things wait for a
      // yes; nothing goes in the basket until then.
      if (answer?.understood?.kind === 'recommend' && answer.understood.items.length > 0) {
        offered.current = answer.understood.items.map((item) => `${item.quantity} ${item.name}`);
        note.current = { brain: 'model', outcome: 'answered' };
        expectNow();
        await say(answer.understood.reply ?? answer.reply ?? 'Shall I add them?');
        return true;
      }
      if (answer?.reply) {
        // The server keeps this one itself, with the words it answered.
        return (await say(answer.reply), true);
      }
      // The language model heard shopping in it (ruling 69): "I've run out of flour" is an order.
      if (answer?.understood && answer.understood.items.length > 0) {
        heardItems.current = answer.understood;
        return false;
      }
      if (quiet.current.quiet()) return true;
      quiet.current.start();
      expectNow();
      note.current = { brain: 'none', outcome: 'unanswered' };
      await say(smallTalk.nudge);
      return true;
    },
    [say, anyInCatalogue],
  );

  const reset = useCallback(() => {
    stage.current = { kind: 'idle' };
    pending.current = [];
    picked.current = [];
  }, []);

  /**
   * What was just said goes into the basket with whatever was already there (review of
   * 16 October 2026): a voice order adds, it never throws away shopping chosen on the screen.
   * Gives back the whole basket as it now stands, for the read-back and for the order.
   */
  const putInBasket = useCallback((): Picked[] => {
    const { basket: current } = live.current;
    const whole: Picked[] = current.lines.map((line) => ({
      product: line.item,
      quantity: line.quantity,
    }));
    for (const { product, quantity } of picked.current) {
      const already = whole.find((line) => line.product.id === product.id);
      if (already) {
        already.quantity += quantity;
      } else {
        whole.push({ product, quantity });
      }
      current.add(product);
      current.setQuantity(product.id, already?.quantity ?? quantity);
    }
    return whole;
  }, []);

  const readBack = useCallback(
    async (notes: string, options: { alreadyInBasket?: boolean } = {}) => {
      if (picked.current.length === 0) {
        reset();
        note.current = { brain: 'shopping', outcome: 'not-found' };
        await say(`${notes}I haven't added anything, so there is no order.`);
        return;
      }
      // Sending the basket as it stands (16 October 2026): nothing is put in again.
      const items = options.alreadyInBasket ? picked.current : putInBasket();
      const goodsPence = items.reduce(
        (sum, { product, quantity }) => sum + product.estimatedPricePence * quantity,
        0,
      );
      // Prices are said with their item charges in (ruling 58), and delivery is the Shopper's
      // own: the same sums the server does.
      const itemChargesPence = itemChargesForLines(
        items.map(({ product, quantity }) => ({
          shopPricePence: product.estimatedPricePence,
          quantity,
        })),
        storeConfig.fees,
      );
      const shoppingPence = goodsPence + itemChargesPence;
      const plan = live.current.shopper?.deliveryPlan ?? 'payg';
      const list = items
        .map(
          ({ product, quantity }, index) =>
            `${index > 0 && index === items.length - 1 ? 'and ' : ''}${quantity} ${product.name}`,
        )
        .join(', ');

      // A restaurant order (Anthony, 30 October 2026): one restaurant's dishes on their own, at
      // least the smallest order, with the flat restaurant fee in place of delivery.
      const restaurants = items.map(({ product }) => product.restaurant ?? null);
      const restaurant = restaurants[0] ?? null;
      const mixed =
        restaurants.some(Boolean) &&
        restaurants.some((ref) => ref === null || ref.shopId !== restaurant?.shopId);
      if (mixed) {
        reset();
        await say(`${notes}${RESTAURANT_MIXED_WORDS} I've put it all in your basket.`);
        navigate('/basket');
        return;
      }
      if (restaurant && goodsPence < storeConfig.restaurants.minimumOrderPence) {
        reset();
        await say(
          `${notes}${restaurantMinimumWords(storeConfig.restaurants, money)} I've put it in your basket.`,
        );
        navigate('/basket');
        return;
      }

      if (goodsPence > maximumOrderGoodsPence) {
        reset();
        // Ruling 61: told plainly, with both choices. Keeping everything is chosen on the screen,
        // where every order, its Runner and its delivery are shown.
        await say(
          goodsPence > storeConfig.fees.maximumBasketGoodsPence
            ? `${notes}Your shopping comes to about ${money(goodsPence)} at the shop's prices, and one basket holds up to ${money(storeConfig.fees.maximumBasketGoodsPence)}. I've put it all in your basket, so you can take some things out.`
            : `${notes}${overOneRunnerWords(storeConfig.fees, money)} I've put it all in your basket, where you can take something out, or keep everything and see what each Runner brings.`,
        );
        navigate('/basket');
        return;
      }
      const deliveryPence = restaurant
        ? restaurantFeePence(storeConfig.restaurants, goodsPence)
        : deliveryFeePence(goodsPence, plan, storeConfig.fees);
      // The monthly order allowance (ruling 73), counted as the server counts it, and said
      // before the yes. A restaurant order has the restaurant fee instead, and no extra.
      const allowancePlan = live.current.shopper?.allowancePlan ?? 'payg';
      const orderNumber = (live.current.shopper?.ordersThisMonth ?? 0) + 1;
      const allowance = storeConfig.fees.delivery.allowance;
      const extraPence = restaurant
        ? 0
        : allowanceExtraPence(allowancePlan, orderNumber, allowance);
      const allowanceSaid = restaurant
        ? null
        : allowanceWords(allowancePlan, orderNumber, allowance, money);
      const totalPence = shoppingPence + deliveryPence + extraPence;

      let cards: Awaited<ReturnType<typeof listPaymentMethods>>['paymentMethods'] = [];
      try {
        cards = (await listPaymentMethods()).paymentMethods;
      } catch {
        cards = [];
      }
      const card = cards.find((method) => method.isDefault) ?? cards[0];
      if (!card) {
        reset();
        await say(
          `${notes}Before I can send an order, you need a card saved. I've put your shopping in your basket, and opened the screen to add a card.`,
        );
        navigate('/card');
        return;
      }

      const home = live.current.shopper?.deliveryAddress.trim() ?? '';
      if (home === '') {
        reset();
        await say(
          `${notes}I don't have a home address for you yet. I've put your shopping in your basket; you can add your address on the screen.`,
        );
        navigate('/confirm');
        return;
      }

      stage.current = {
        kind: 'address',
        lines: items.map(({ product, quantity }) => ({ catalogueItemId: product.id, quantity })),
        totalPence,
        home,
        cardId: card.id,
        lastFour: card.lastFour,
        breakdown: {
          goodsPence,
          itemChargesPence,
          feePence: deliveryPence + extraPence,
          restaurant: restaurant !== null,
        },
      };
      const feeSaid = restaurant
        ? `the restaurant fee is ${money(deliveryPence)}, in place of delivery`
        : `delivery is ${money(deliveryPence)}`;
      await say(
        `${notes}Here is your order: ${list}. Your shopping comes to about ${money(shoppingPence)}, with the item charges included, and ${feeSaid}${allowanceSaid ? `. ${allowanceSaid} So` : ', so'} about ${money(totalPence)} altogether. It will be delivered to your home address: ${home}. Is that right?`,
      );
    },
    [say, reset, putInBasket, navigate, maximumOrderGoodsPence],
  );

  const next = useCallback(
    async (notesSoFar: string): Promise<void> => {
      let notes = notesSoFar;
      while (pending.current.length > 0) {
        const term = pending.current.shift() as string;
        const { quantity, name } = leadingQuantity(term);
        let found: CatalogueItem[] = [];
        try {
          found = (await searchCatalogue(name)).items;
        } catch {
          reset();
          await say(
            `${notes}I can't reach the shop list at the moment, so I can't take an order by voice just now. Please try again in a little while, or ring us.`,
          );
          return;
        }
        // No single product over the most one product may cost (ruling 58).
        const tooDear = found.filter((option) => !sellable(option.estimatedPricePence));
        found = found.filter((option) => sellable(option.estimatedPricePence));
        if (found.length === 0 && tooDear[0]) {
          notes += `${tooDearWords(tooDear[0].name)} `;
          continue;
        }
        if (found.length === 0) {
          // Never simply left out (19 October 2026): the server asks the language model what it
          // is. A shelf item is added at a typical price; a meal names the cafés that make it.
          const suggestion = await Promise.race<ItemSuggestion>([
            suggestItem(name).catch((): ItemSuggestion => ({ outcome: 'unknown' })),
            new Promise<ItemSuggestion>((resolve) =>
              setTimeout(() => resolve({ outcome: 'unknown' }), SUGGEST_WAIT_MS),
            ),
          ]);
          if (suggestion.outcome === 'added' || suggestion.outcome === 'found') {
            note.current = { brain: 'model', outcome: 'added' };
            picked.current.push({ product: suggestion.item, quantity: quantity ?? 1 });
            if (suggestion.outcome === 'added') {
              notes += `${suggestion.item.name} wasn't in my list yet, so I've added it at about ${money(shownPrice(suggestion.item.estimatedPricePence))}. You pay what the till says. `;
            }
            continue;
          }
          if (suggestion.outcome === 'shops') {
            const names = suggestion.shops.map((shop) => shop.name);
            // Preferred Partners are named first (30 October 2026), and Ozi says why.
            const why = suggestion.shops[0]?.preferred
              ? ` ${preferredRankingWords(storeConfig.assistantName)}`
              : '';
            notes +=
              names.length > 0
                ? `${suggestion.reply} On ${storeConfig.productName}: ${names.slice(0, -1).join(', ')}${names.length > 1 ? ' and ' : ''}${names[names.length - 1]}.${why} Say open and the name to see what they have. `
                : `${suggestion.reply} No cafés or takeaways have joined near you yet. `;
            continue;
          }
          if (suggestion.outcome === 'refused') {
            notes += `${suggestion.reply} `;
            continue;
          }
          notes += `I don't have ${name} in my list yet. I've noted it so we can add it. `;
          continue;
        }
        if (found.length > 1) {
          const options = found.slice(0, 3);
          stage.current = { kind: 'choosing', name, options, quantity };
          const listed = options
            .map(
              (option, index) =>
                `${['one', 'two', 'three'][index]}, ${option.name}, about ${money(shownPrice(option.estimatedPricePence))}`,
            )
            .join('; ');
          await say(
            `${notes}I found ${options.length} kinds of ${name}: ${listed}. Which would you like? You can say none.`,
          );
          return;
        }
        const product = found[0] as CatalogueItem;
        if (quantity !== null) {
          picked.current.push({ product, quantity });
          continue;
        }
        stage.current = { kind: 'quantity', product, retried: false };
        await say(`${notes}How many ${product.name} would you like?`);
        return;
      }
      await readBack(notes);
    },
    [say, reset, readBack],
  );

  /**
   * A later day, a time of day, or when to take the money, said at the payment question (ruling
   * 78): checked, priced for the month it is delivered in, and the question asked again.
   */
  const rebook = useCallback(
    async (
      current: Extract<Stage, { kind: 'payment' }>,
      heard: ReturnType<typeof parseSpokenSchedule>,
    ): Promise<void> => {
      if (heard.bank) {
        await say(
          `Paying by bank transfer can be chosen on the confirmation screen. ${current.statement} Say yes to send it and pay, or no to stop.`,
        );
        return;
      }
      let booking: VoiceBooking | undefined;
      if (!heard.asap) {
        const deliveryDay = heard.deliveryDay ?? current.booking?.deliveryDay;
        if (!deliveryDay) {
          await say(`Which day would you like it? ${ANOTHER_DAY}`);
          return;
        }
        booking = {
          deliveryDay,
          window: heard.window ?? current.booking?.window ?? 'morning',
        };
        if (!heard.chargeNow) {
          const chargeDay =
            heard.chargeDay ??
            current.booking?.chargeDay ??
            (heard.chargeTime ? deliveryDay : undefined);
          const chargeTime = heard.chargeTime ?? current.booking?.chargeTime;
          if (chargeDay) booking.chargeDay = chargeDay;
          if (chargeTime) booking.chargeTime = chargeTime;
        }
        const check = checkSchedule(
          {
            deliveryDay: booking.deliveryDay,
            window: booking.window,
            chargePlan: booking.chargeDay ? 'scheduled' : 'now',
            chargeDay: booking.chargeDay,
            chargeTime: booking.chargeTime ?? storeConfig.scheduled.defaultChargeTime,
          },
          new Date(),
          storeConfig.scheduled,
        );
        if (!check.ok) {
          await say(
            `${check.message} ${current.statement} Say yes to send it and pay, or no to stop.`,
          );
          return;
        }
      }
      // Booked into another month, the monthly allowance is counted there (ruling 73).
      let totalPence = current.totalPence;
      if (booking && booking.deliveryDay.slice(0, 7) !== ukDay(new Date()).slice(0, 7)) {
        try {
          totalPence = (await priceBasketRemotely(current.lines, booking.deliveryDay)).totalPence;
        } catch {
          // The server prices it again when it is sent, and says if the figure moved.
        }
      }
      if (totalPence > ceiling) {
        reset();
        await say(
          `Because this comes to more than ${money(ceiling)}, I need you to confirm it by touch. I've opened the confirmation screen for you.`,
        );
        navigate('/confirm');
        return;
      }
      const statement = paymentQuestion(totalPence, current.lastFour, booking);
      stage.current = {
        ...current,
        totalPence,
        statement,
        booking,
      };
      await say(`${statement} Say yes to send it and pay, or no to stop.`);
    },
    [say, reset, navigate, ceiling],
  );

  /**
   * The gentle warning before the final yes, when the home area has no Runner yet or is paused
   * (30 October 2026), with the question; '' when there is nothing to say or it cannot be asked.
   */
  const noRunnerWarning = useCallback(async (home: string): Promise<string> => {
    try {
      const area = await fetchMyArea();
      if (!area.warn) return '';
      markAreaWarned(home).catch(() => undefined);
      return `${storeConfig.areas.noRunnerWords} ${storeConfig.areas.goAheadQuestion} `;
    } catch {
      return '';
    }
  }, []);

  const handle = useCallback(
    async (text: string): Promise<boolean> => {
      const current = stage.current;
      lastHeard.current = text;
      note.current = { brain: current.kind === 'idle' ? 'shopping' : 'flow', outcome: 'asked' };

      if (current.kind !== 'idle' && wantsToStop(text)) {
        reset();
        note.current = { brain: 'flow', outcome: 'stopped' };
        await say("All right, I've stopped. Nothing has been sent, and nothing has been charged.");
        return true;
      }

      switch (current.kind) {
        case 'idle': {
          const addressed = nameHeardIn(text);
          // "Open Wok Kitchen", "show me the corner shop": a listed shop's own page (19 October
          // 2026), after Ozi has named the cafés that make a dish.
          const opening = OPEN_SHOP.exec(
            text
              .replace(
                new RegExp(`^\\s*((hey|hi|hello|ok|okay)[\\s,]+)?${NAME_PATTERN}[\\s,.]*`, 'i'),
                '',
              )
              .replace(/[.!?]+$/, '')
              .trim(),
          );
          if (opening && (addressed || isExpecting())) {
            const wantedShop = opening[1]!.toLowerCase().replace(/^the\s+/, '');
            try {
              const { shops } = await fetchShops();
              const match = shops.find((one) => one.name.toLowerCase().includes(wantedShop));
              if (match) {
                navigate(`/shops/${match.id}`);
                note.current = { brain: 'flow', outcome: 'answered' };
                await say(
                  `Here is ${match.name}. Say what you'd like from it, or tap plus beside it.`,
                );
                return true;
              }
            } catch {
              // The shops list cannot be reached: carry on as if it were not asked.
            }
          }
          if (!isExpecting() && !addressed && !ORDER_INTENT.test(text)) return false;
          // Nobody signed in, and not said to Ozi: a stray word ("Rectangle") is not an order
          // and never earns "you need an account first" (19 October 2026). Like a phone's own
          // assistant, Ozi waits for its name, or for words that clearly ask for something.
          if (!live.current.shopper && !addressed && !ORDER_INTENT.test(text)) return false;
          // Small talk and general statements are not shopping (ruling 66): "how are you
          // doing" is answered warmly, never with "I haven't added how are you doing".
          // A yes to Ozi's recommendation puts its things in, through the usual read-back.
          if (offered.current) {
            const waiting = offered.current;
            offered.current = null;
            const answer = parseYesNo(text);
            if (answer === 'yes' || /\b(add (them|those|it|all)|go on|sounds good)\b/i.test(text)) {
              picked.current = [];
              pending.current = waiting;
              expectingUntil.current = null;
              await next('');
              return true;
            }
            if (answer === 'no') {
              await say('All right. What would you like instead?');
              expectNow();
              return true;
            }
          }
          const parsed = splitItems(text, NAME_PATTERN);
          heardItems.current = null;
          if (await chatter(text, parsed.items)) return true;
          expectingUntil.current = null;
          quiet.current.clear();
          // The language model's hearing of the sentence, when the parser's would miss (ruling 69).
          let { items } = parsed;
          const { shopAskedFor } = parsed;
          if (heardItems.current === null && (items.length === 0 || needsEars(text))) {
            const answer = await askWithin(text);
            if (answer?.understood?.kind === 'recommend' && answer.understood.items.length > 0) {
              offered.current = answer.understood.items.map(
                (item) => `${item.quantity} ${item.name}`,
              );
              note.current = { brain: 'model', outcome: 'answered' };
              expectNow();
              await say(answer.understood.reply ?? answer.reply ?? 'Shall I add them?');
              return true;
            }
            if (answer?.understood && answer.understood.items.length > 0) {
              heardItems.current = answer.understood;
            } else if (answer?.reply) {
              note.current = { brain: 'model', outcome: 'answered' };
              await say(answer.reply);
              return true;
            }
          }
          if (heardItems.current) {
            note.current = { brain: 'model', outcome: 'asked' };
            items = heardItems.current.items.map((item) => `${item.quantity} ${item.name}`);
            heardItems.current = null;
          }
          if (!live.current.shopper) {
            if (offerAccount) {
              offerAccount();
              return true;
            }
            await say(
              'To order, you need an account first. I can set one up with you now, just by talking. Say "create my account". Or ring us, and a person will take your order.',
            );
            return true;
          }
          if (items.length === 0) {
            expectNow();
            await say('What would you like? You can say, for example, bananas and milk.');
            return true;
          }
          picked.current = [];
          pending.current = items;
          const shopNote =
            shopAskedFor && !shopAskedFor.toLowerCase().includes(shop.toLowerCase())
              ? `We don't list ${shopAskedFor} yet, so I'll look in our shared price list. `
              : '';
          await next(shopNote);
          return true;
        }

        case 'choosing': {
          if (/\b(none|neither|leave it|skip)\b/i.test(text)) {
            await next(`All right, no ${current.name}. `);
            return true;
          }
          const choice = parseChoice(text, current.options.length);
          if (choice === null) {
            await say(
              `Please say one, two${current.options.length > 2 ? ' or three' : ''}, or none.`,
            );
            return true;
          }
          const product = current.options[choice] as CatalogueItem;
          if (current.quantity !== null) {
            picked.current.push({ product, quantity: current.quantity });
            await next('');
          } else {
            stage.current = { kind: 'quantity', product, retried: false };
            await say(`How many ${product.name} would you like?`);
          }
          return true;
        }

        case 'quantity': {
          const quantity = parseQuantity(text);
          if (quantity === null) {
            if (current.retried) {
              await next(`I'll leave out the ${current.product.name}. `);
            } else {
              stage.current = { ...current, retried: true };
              await say('Sorry, how many? Say a number, like two.');
            }
            return true;
          }
          picked.current.push({ product: current.product, quantity });
          await next('');
          return true;
        }

        case 'address': {
          const answer = parseYesNo(text);
          if (answer === null) {
            await say(`Please say yes or no. Is ${current.home} the right address?`);
            return true;
          }
          if (answer === 'no') {
            reset();
            await say(
              "An order by voice can only go to your home address, to keep your account safe. To send it somewhere else, please use the screen. I've put everything in your basket and opened it for you.",
            );
            navigate('/confirm');
            return true;
          }
          if (current.totalPence > ceiling) {
            reset();
            await say(
              `Because this comes to more than ${money(ceiling)}, I need you to confirm it by touch. I've opened the confirmation screen for you.`,
            );
            navigate('/confirm');
            return true;
          }
          const statement = paymentQuestion(current.totalPence, current.lastFour);
          stage.current = {
            kind: 'payment',
            lines: current.lines,
            totalPence: current.totalPence,
            home: current.home,
            cardId: current.cardId,
            lastFour: current.lastFour,
            statement,
          };
          // Every area is open (Anthony, 30 October 2026). Where their home area has no Runner
          // yet, or is paused, Ozi says so gently before the final yes, once for this order, and
          // they choose; nothing is stopped. It is never said earlier than this.
          const warning = await noRunnerWarning(current.home);
          // Checkout insights (30 October 2026): the order and its total were said, by voice.
          if (current.breakdown) {
            recordCheckoutViewed({
              ...current.breakdown,
              totalPence: current.totalPence,
              area: current.home,
              noRunnerWarning: warning !== '',
              channel: 'voice',
            }).catch(() => undefined);
          }
          await say(
            `${warning}${statement} Say yes to send it and pay, or no to stop. ${ANOTHER_DAY}`,
          );
          return true;
        }

        case 'payment': {
          // "Deliver it on Saturday morning", "take the money on the first at five past
          // midnight" (ruling 78): the booking changes, and the question is asked again.
          const heardBooking = parseSpokenSchedule(text, new Date());
          if (
            heardBooking.deliveryDay ||
            heardBooking.window ||
            heardBooking.chargeDay ||
            heardBooking.chargeTime ||
            heardBooking.bank ||
            (current.booking && (heardBooking.asap || heardBooking.chargeNow))
          ) {
            await rebook(current, heardBooking);
            return true;
          }
          const answer = parseYesNo(text);
          if (answer === null) {
            await say('Please say yes to send it and pay, or no to stop.');
            return true;
          }
          const { lines } = current;
          if (answer === 'no') {
            reset();
            await say(
              'All right. Nothing has been sent, and nothing has been charged. Your shopping is in your basket if you want it.',
            );
            return true;
          }
          reset();
          try {
            const booking = current.booking;
            const result = await createOrder({
              lines,
              deliveryAddress: current.home,
              paymentMethodId: current.cardId,
              ...(booking
                ? {
                    schedule: {
                      deliveryDay: booking.deliveryDay,
                      window: booking.window,
                      pay: booking.chargeDay ? ('scheduled' as const) : ('now' as const),
                      ...(booking.chargeDay
                        ? {
                            chargeDay: booking.chargeDay,
                            chargeTime:
                              booking.chargeTime ?? storeConfig.scheduled.defaultChargeTime,
                          }
                        : {}),
                    },
                  }
                : {}),
              confirmation: {
                statement: current.statement,
                agreedTotalPence: current.totalPence,
                channel: 'voice',
                addressConfirmed: true,
              },
            });
            // The bank wants its own check (16 October 2026): the same step the confirmation
            // screen opens, said aloud first so nobody is surprised by a screen they cannot see.
            if (result.payment?.requiresAction && result.payment.clientSecret) {
              await say(
                `${result.message} Your bank's own screen is opening now. Follow what it says, or ask someone you trust to help. Nothing is taken until the bank says yes.`,
              );
              const check = await completeBankCheck(result.payment.clientSecret);
              if (!check.ok) {
                await say(`${check.message} Your shopping is still in your basket.`);
                return true;
              }
              live.current.basket.clear();
              void refresh();
              await say(
                'Thank you, your bank said yes. You can follow your order on the Your order page.',
              );
              navigate('/my-order');
              return true;
            }
            live.current.basket.clear();
            void refresh();
            note.current = { brain: 'flow', outcome: 'sent' };
            if (booking) {
              await say(`${result.message} You can see it under Past orders.`);
              navigate('/orders');
              return true;
            }
            await say(`${result.message} You can follow it on the Your order page.`);
            navigate('/my-order');
          } catch (failure) {
            await say(
              failure instanceof Error
                ? failure.message
                : 'Something went wrong, and nothing has been charged.',
            );
          }
          return true;
        }
      }
    },
    [
      say,
      offerAccount,
      reset,
      next,
      navigate,
      ceiling,
      shop,
      chatter,
      refresh,
      rebook,
      noRunnerWarning,
    ],
  );

  const expectOrder = useCallback(() => {
    expectNow();
  }, []);

  const busy = useCallback(() => stage.current.kind !== 'idle', []);

  const sendBasket = useCallback(async () => {
    const { shopper: who, basket: current } = live.current;
    lastHeard.current = '';
    note.current = { brain: 'flow', outcome: 'asked' };
    if (!who) {
      if (offerAccount) offerAccount();
      else await say('To send an order, you need an account first. Say "create my account".');
      return;
    }
    if (current.lines.length === 0) {
      expectNow();
      await say(
        'Your basket is empty, so there is nothing to send yet. What would you like? You can say, for example, bananas and milk.',
      );
      return;
    }
    reset();
    picked.current = current.lines.map((line) => ({ product: line.item, quantity: line.quantity }));
    // What was picked is the basket itself, so the read-back must not add it again.
    await readBack('', { alreadyInBasket: true });
  }, [say, offerAccount, reset, readBack]);

  return { busy, expectOrder, handle, sendBasket };
}
