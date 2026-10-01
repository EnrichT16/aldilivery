import { useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { storeConfig } from '../config';
import { createOrder, listPaymentMethods, searchCatalogue, type CatalogueItem } from '../lib/api';
import { money } from '../lib/money';
import { parseChoice, parseQuantity, parseYesNo, splitItems, wantsToStop } from '../voice/ordering';
import type { SpeakOutcome } from '../voice';
import { useBasket } from './basket';
import { useSession } from './session';

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
  | { kind: 'address'; totalPence: number; home: string; cardId: string; lastFour: string }
  | {
      kind: 'payment';
      totalPence: number;
      home: string;
      cardId: string;
      statement: string;
    };

interface Picked {
  product: CatalogueItem;
  quantity: number;
}

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
}

export function useVoiceOrdering(say: (text: string) => Promise<SpeakOutcome>): VoiceOrdering {
  const { shopper } = useSession();
  const basket = useBasket();
  const navigate = useNavigate();
  const assistant = storeConfig.assistantName;
  const shop = storeConfig.store.displayName;
  const { standardDeliveryPence, maximumGoodsPence } = storeConfig.fees;
  const ceiling = storeConfig.voice.paymentCeilingPence;

  const stage = useRef<Stage>({ kind: 'idle' });
  const pending = useRef<string[]>([]);
  const picked = useRef<Picked[]>([]);
  const expecting = useRef(false);
  // Read through refs so the conversation always sees the current account and basket.
  const live = useRef({ shopper, basket });
  live.current = { shopper, basket };

  const reset = useCallback(() => {
    stage.current = { kind: 'idle' };
    pending.current = [];
    picked.current = [];
  }, []);

  const putInBasket = useCallback(() => {
    const { basket: current } = live.current;
    current.clear();
    for (const { product, quantity } of picked.current) {
      current.add(product);
      current.setQuantity(product.id, quantity);
    }
  }, []);

  const readBack = useCallback(
    async (notes: string) => {
      const items = picked.current;
      if (items.length === 0) {
        reset();
        await say(`${notes}I haven't added anything, so there is no order.`);
        return;
      }
      const goodsPence = items.reduce(
        (sum, { product, quantity }) => sum + product.estimatedPricePence * quantity,
        0,
      );
      const totalPence = goodsPence + standardDeliveryPence;
      const list = items
        .map(
          ({ product, quantity }, index) =>
            `${index > 0 && index === items.length - 1 ? 'and ' : ''}${quantity} ${product.name}`,
        )
        .join(', ');
      putInBasket();

      if (goodsPence > maximumGoodsPence) {
        reset();
        await say(
          `${notes}Your shopping comes to about ${money(goodsPence)}. One delivery carries up to ${money(maximumGoodsPence)}, about as much as one Runner can carry safely. I've put it all in your basket, so you can take some things out and send the rest as a second delivery.`,
        );
        navigate('/basket');
        return;
      }

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
        totalPence,
        home,
        cardId: card.id,
        lastFour: card.lastFour,
      };
      await say(
        `${notes}Here is your order: ${list}. Your shopping comes to about ${money(goodsPence)}, and delivery is ${money(standardDeliveryPence)}, so about ${money(totalPence)} altogether. It will be delivered to your home address: ${home}. Is that right?`,
      );
    },
    [say, reset, putInBasket, navigate, standardDeliveryPence, maximumGoodsPence],
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
                `${['one', 'two', 'three'][index]}, ${option.name}, about ${money(option.estimatedPricePence)}`,
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
          const addressed = new RegExp(`\\b${assistant}\\b`, 'i').test(text);
          if (!expecting.current && !addressed && !ORDER_INTENT.test(text)) return false;
          expecting.current = false;
          if (!live.current.shopper) {
            await say(
              'To order by voice, you need an account first. You can set one up on the screen by pressing Shopper, or ring us and a person will take your order.',
            );
            return true;
          }
          const { items, shopAskedFor } = splitItems(text, assistant);
          if (items.length === 0) {
            expecting.current = true;
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
          const statement = `Shall I send your order now, and charge about ${money(current.totalPence)} to your card ending ${current.lastFour}? You pay what the till says.`;
          stage.current = {
            kind: 'payment',
            totalPence: current.totalPence,
            home: current.home,
            cardId: current.cardId,
            statement,
          };
          await say(`${statement} Say yes to send it, or no to stop.`);
          return true;
        }

        case 'payment': {
          const answer = parseYesNo(text);
          if (answer === null) {
            await say('Please say yes to send it, or no to stop.');
            return true;
          }
          const lines = picked.current.map(({ product, quantity }) => ({
            catalogueItemId: product.id,
            quantity,
          }));
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
            live.current.basket.clear();
            await say(
              result.payment.requiresAction
                ? `${result.message} Please finish on the screen.`
                : `${result.message} You can follow it on the Your order page.`,
            );
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
    [assistant, say, reset, next, navigate, ceiling, shop],
  );

  const expectOrder = useCallback(() => {
    expecting.current = true;
  }, []);

  const busy = useCallback(() => stage.current.kind !== 'idle', []);

  return { busy, expectOrder, handle };
}
