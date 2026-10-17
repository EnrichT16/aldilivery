import { useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { deliveryFeePence, itemChargesForLines, overOneRunnerWords } from '@aldilivery/core';

import { storeConfig } from '../config';
import { createOrder, listPaymentMethods, searchCatalogue, type CatalogueItem } from '../lib/api';
import { money, sellable, shownPrice, tooDearWords } from '../lib/money';
import { completeBankCheck } from '../lib/stripe';
import { parseChoice, parseQuantity, parseYesNo, splitItems, wantsToStop } from '../voice/ordering';
import type { SpeakOutcome } from '../voice';
import { useBasket } from './basket';
import { useSession } from './session';
import { NAME_PATTERN, nameHeardIn } from '../voice/name';
import { phraseReply } from '../voice/phrases';
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
    }
  | {
      kind: 'payment';
      lines: OrderLine[];
      totalPence: number;
      home: string;
      cardId: string;
      statement: string;
    };

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

const ORDER_INTENT = /\b(order|want|like|need|get|buy|have|bring|send|shopping|basket)\b/i;

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
  say: (text: string) => Promise<SpeakOutcome>,
  /** No account yet: Ozi asks whether to open one now, by talking. */
  offerAccount?: () => void,
): VoiceOrdering {
  const { shopper } = useSession();
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
        await say(smallTalkReply(small, chatterTurn.current));
        chatterTurn.current += 1;
        return true;
      }
      if (!looksLikeChatter(text) || (await anyInCatalogue(items))) return false;
      const known = await phraseReply(text, chatterTurn.current, 'within', { kind: 'shopper' });
      chatterTurn.current += 1;
      if (known) {
        await say(known);
        return true;
      }
      if (quiet.current.quiet()) return true;
      quiet.current.start();
      expectNow();
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
      const deliveryPence = deliveryFeePence(goodsPence, plan, storeConfig.fees);
      const totalPence = shoppingPence + deliveryPence;

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
      };
      await say(
        `${notes}Here is your order: ${list}. Your shopping comes to about ${money(shoppingPence)}, with the item charges included, and delivery is ${money(deliveryPence)}, so about ${money(totalPence)} altogether. It will be delivered to your home address: ${home}. Is that right?`,
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
          notes += `I couldn't find ${name}, so I'll leave it out. `;
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

  const handle = useCallback(
    async (text: string): Promise<boolean> => {
      const current = stage.current;

      if (current.kind !== 'idle' && wantsToStop(text)) {
        reset();
        await say("All right, I've stopped. Nothing has been sent, and nothing has been charged.");
        return true;
      }

      switch (current.kind) {
        case 'idle': {
          const addressed = nameHeardIn(text);
          if (!isExpecting() && !addressed && !ORDER_INTENT.test(text)) return false;
          // Small talk and general statements are not shopping (ruling 66): "how are you
          // doing" is answered warmly, never with "I haven't added how are you doing".
          const { items, shopAskedFor } = splitItems(text, NAME_PATTERN);
          if (await chatter(text, items)) return true;
          expectingUntil.current = null;
          quiet.current.clear();
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
              ? `We don't list ${shopAskedFor} yet, so I'll look in ${shop}. `
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
          const statement = `Shall I send your order and pay now, charging about ${money(current.totalPence)} to your card ending ${current.lastFour}? You pay what the till says.`;
          stage.current = {
            kind: 'payment',
            lines: current.lines,
            totalPence: current.totalPence,
            home: current.home,
            cardId: current.cardId,
            statement,
          };
          await say(`${statement} Say yes to send it and pay, or no to stop.`);
          return true;
        }

        case 'payment': {
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
            const result = await createOrder({
              lines,
              deliveryAddress: current.home,
              paymentMethodId: current.cardId,
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
              await say(
                'Thank you, your bank said yes. You can follow your order on the Your order page.',
              );
              navigate('/my-order');
              return true;
            }
            live.current.basket.clear();
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
    [say, offerAccount, reset, next, navigate, ceiling, shop, chatter],
  );

  const expectOrder = useCallback(() => {
    expectNow();
  }, []);

  const busy = useCallback(() => stage.current.kind !== 'idle', []);

  const sendBasket = useCallback(async () => {
    const { shopper: who, basket: current } = live.current;
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
