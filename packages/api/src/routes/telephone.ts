/**
 * Ordering by telephone, answered by Ozi (rulings 28, 29 and 45).
 *
 * The Twilio number rings here. Ozi greets the caller and finds their account by the number
 * they rang from:
 *
 * - **Known, with a card and a home address:** Ozi asks what they would like, adds each thing,
 *   asks "anything else?", and when they say that is everything, reads the whole order back
 *   slowly with the shopping, the delivery fee and the total, the card, and the home address.
 *   Only after a yes is the order sent, through exactly the same checks as an order in the app
 *   (a spoken yes, the voice spending ceiling, home address only, the saved card).
 * - **Known, but no card or address yet:** a card is never spoken to Ozi (ruling 29). Ozi
 *   texts a link so they, or someone they trust, add it once on the website.
 * - **Not known:** Ozi asks to keep their number for the call, giving the reason first ("just
 *   in case this call gets cut off, I'll call you back"), asks their name, and texts them the
 *   link to open an account. No account is made from a phone call alone, because the number a
 *   call shows can be faked.
 *
 * If the call is cut off in the middle, and they agreed, Ozi rings them back once and carries
 * on where they were. Every request must carry Twilio's signature, or it is refused.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { formatPence, parseQuantity, parseYesNo, splitItems, wantsToStop } from '@aldilivery/core';

import type { CatalogueItem } from '../domain.js';
import { isUkMobile, ukPhone } from '../lib/phone.js';
import { signSession } from '../lib/tokens.js';
import {
  ask,
  escapeXml,
  goodbye,
  openState,
  sealState,
  signedByTwilio,
  type CallState,
} from '../lib/twilio-voice.js';
import { priceLines } from '../services/basket.js';

/** A conversation is allowed this long, from its last step, before it must start again. */
const STATE_MINUTES = 30;
/** Calls remembered, to ring back if cut off, for this long. */
const REMEMBER_MS = 60 * 60 * 1000;

const DONE =
  /\b(that'?s (it|all|everything)|that is (it|all|everything)|nothing else|no more|i'?m done|finished|no thanks?|no thank you|^no$)\b/i;
const REMOVE = /^\s*(please\s+)?(take off|remove|take away|cancel|no)\s+(the\s+)?(.+)$/i;
const REPEAT = /\b(repeat|say (that|it) again|come again|pardon|what did you say)\b/i;

interface Remembered {
  phone: string;
  sealed: string | null;
  finished: boolean;
  calledBack: boolean;
  at: number;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function listWords(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The thing asked for, without how many: "two pints of milk" → "milk". */
function thingAskedFor(phrase: string): string {
  return phrase
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(
      /\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|couple|pair|of|some|please|packs?|packets?|bottles?|pints?|loaf|loaves|tins?|cans?|bags?|boxes|box|jars?|cartons?)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** The best match: the name itself, then a name starting with it, then a whole word. */
function bestMatch(items: CatalogueItem[], wanted: string): CatalogueItem | null {
  const score = (item: CatalogueItem): number => {
    const name = item.name.toLowerCase();
    if (name === wanted) return 0;
    if (name.startsWith(wanted)) return 1;
    if (new RegExp(`\\b${wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(name)) return 2;
    return 3;
  };
  return [...items].sort((a, b) => score(a) - score(b))[0] ?? null;
}

export async function registerTelephoneRoutes(app: FastifyInstance): Promise<void> {
  const { env, repository, config, now } = app.ctx;
  const symbol = config.store.currencySymbol;
  const money = (pence: number): string => formatPence(pence, symbol);
  const calls = new Map<string, Remembered>();

  const base = (): string => `${env.primaryOrigin ?? ''}/api/webhooks/twilio`;

  function forget(): void {
    const cutOff = now().getTime() - REMEMBER_MS;
    for (const [sid, call] of calls) if (call.at < cutOff) calls.delete(sid);
  }

  /** Refuses anything Twilio did not sign. The address may arrive with or without `/api`. */
  function verified(request: FastifyRequest): Record<string, string> | null {
    const token = env.twilioAuthToken;
    const origin = env.primaryOrigin;
    if (!token || !origin) return null;
    const params = Object.fromEntries(
      Object.entries((request.body ?? {}) as Record<string, unknown>).map(([k, v]) => [
        k,
        String(v),
      ]),
    );
    const path = request.url;
    const urls = path.startsWith('/api/')
      ? [`${origin}${path}`, `${origin}${path.slice(4)}`]
      : [`${origin}${path}`, `${origin}/api${path}`];
    const signature = request.headers['x-twilio-signature'];
    const given = Array.isArray(signature) ? signature[0] : signature;
    return signedByTwilio(token, urls, params, given) ? params : null;
  }

  function reply(response: FastifyReply, twiml: string): FastifyReply {
    return response.type('text/xml; charset=utf-8').send(twiml);
  }

  function refused(response: FastifyReply): FastifyReply {
    return response.status(403).type('text/plain').send('Not signed by Twilio.');
  }

  function next(state: Omit<CallState, 'expiresAt'>, sid: string): string {
    const sealed = sealState(
      { ...state, expiresAt: Math.floor(now().getTime() / 1000) + STATE_MINUTES * 60 },
      env.authTokenSecret,
    );
    const remembered = calls.get(sid);
    if (remembered) {
      remembered.sealed = sealed;
      remembered.at = now().getTime();
    }
    return `${base()}/voice/step?s=${encodeURIComponent(sealed)}`;
  }

  function finish(sid: string): void {
    const remembered = calls.get(sid);
    if (remembered) remembered.finished = true;
  }

  async function textLink(phone: string, name: string | null): Promise<boolean> {
    if (!app.ctx.sendText || !isUkMobile(phone)) return false;
    const site = env.primaryOrigin ?? '';
    const hello = name ? `Hello ${firstName(name)}. ` : '';
    await app.ctx
      .sendText(
        phone,
        `${hello}${config.productName}: to order by phone, add your card and home address once, here: ${site}/sign-up . You or someone you trust can do it. Then ring us and ${config.assistantName} will take your order. We will never ask for your card on a call.`,
      )
      .catch((failure: unknown) => {
        app.log.warn({ err: failure }, 'The sign-up link could not be texted.');
      });
    return true;
  }

  /** What is in the basket, in words, and what it comes to. */
  async function readBack(lines: Array<[string, number]>) {
    const items = await repository.catalogue.findManyByIds(lines.map(([id]) => id));
    const priced = priceLines(
      lines.map(([catalogueItemId, quantity]) => ({ catalogueItemId, quantity })),
      items,
      config.fees,
    );
    const words = listWords(priced.lines.map((line) => `${line.quantity} ${line.name}`));
    return { priced, words };
  }

  /** The order so far, then "anything else?". */
  function more(state: Omit<CallState, 'expiresAt'>, sid: string, opening: string): string {
    return ask(
      `${opening} Anything else? When you have everything, say: that's everything.`,
      next({ ...state, step: 'items', quiet: 0 }, sid),
    );
  }

  /* -------------------------------------------------------------- the call arrives */

  app.post('/webhooks/twilio/voice', async (request, response) => {
    const params = verified(request);
    if (!params) return refused(response);
    forget();

    const sid = params['CallSid'] ?? '';
    const outbound = (params['Direction'] ?? '').startsWith('outbound');
    const phone = ukPhone(outbound ? (params['To'] ?? '') : (params['From'] ?? ''));
    const assistant = config.assistantName;

    // Ringing back after a cut-off call: carry on where they were.
    const resumed = (request.query as { s?: string }).s;
    if (outbound && resumed) {
      const state = openState(resumed, env.authTokenSecret, now());
      if (state && phone) {
        calls.set(sid, {
          phone,
          sealed: resumed,
          finished: false,
          calledBack: true,
          at: now().getTime(),
        });
        const opening = `Hello, it's ${assistant}, ringing you back because we were cut off.`;
        if (state.step === 'items' && state.lines.length > 0) {
          const { words } = await readBack(state.lines);
          return reply(response, more(state, sid, `${opening} So far you have ${words}.`));
        }
        if (!state.shopperId) {
          return reply(
            response,
            ask(
              `${opening} What is your first name and your surname?`,
              next({ ...state, step: 'name', quiet: 0 }, sid),
            ),
          );
        }
        return reply(
          response,
          ask(
            `${opening} Let's carry on. What would you like?`,
            next({ ...state, step: 'items', quiet: 0 }, sid),
          ),
        );
      }
    }

    if (!phone) {
      return reply(
        response,
        goodbye(
          `Hello, I'm ${assistant}. Your number is hidden, so I can't find your account. Please ring again with your number showing. Goodbye.`,
        ),
      );
    }

    const shopper = await repository.shoppers.findByPhone(phone);
    calls.set(sid, {
      phone,
      sealed: null,
      finished: false,
      calledBack: false,
      at: now().getTime(),
    });

    if (!shopper) {
      calls.get(sid)!.finished = true;
      return reply(
        response,
        ask(
          `Hello, I'm ${assistant}, from ${config.productName}. ${config.motto} I don't have an account for this number yet. Just in case this call gets cut off, I'd like to keep your number so I can call you back. May I? Say yes or no.`,
          next({ step: 'consent', lines: [], quiet: 0, callBack: false }, sid),
        ),
      );
    }

    const cards = await repository.paymentMethods.listForShopper(shopper.id);
    if (cards.length === 0 || shopper.deliveryAddress.trim() === '') {
      finish(sid);
      const texted = await textLink(phone, shopper.displayName);
      return reply(
        response,
        goodbye(
          `Hello ${firstName(shopper.displayName)}, it's ${assistant}. To order by phone, your card and home address need adding once, on the website, by you or someone you trust. A card is never given to me on a call. ` +
            (texted
              ? "I've sent you a text with the link. "
              : `The address is ${(env.primaryOrigin ?? '').replace(/^https?:\/\//, '')}. `) +
            'Once that is done, ring me and I will take your order. Goodbye.',
        ),
      );
    }

    return reply(
      response,
      ask(
        `Hello ${firstName(shopper.displayName)}, it's ${assistant}. What would you like from the shop today? For example, say: two pints of milk and a loaf of bread.`,
        next({ step: 'items', shopperId: shopper.id, lines: [], quiet: 0, callBack: true }, sid),
      ),
    );
  });

  /* -------------------------------------------------------------- each answer */

  app.post('/webhooks/twilio/voice/step', async (request, response) => {
    const params = verified(request);
    if (!params) return refused(response);
    const sid = params['CallSid'] ?? '';
    const sealed = (request.query as { s?: string }).s ?? '';
    const state = openState(sealed, env.authTokenSecret, now());
    if (!state) {
      finish(sid);
      return reply(
        response,
        goodbye('Sorry, that took too long and I lost my place. Please ring again. Goodbye.'),
      );
    }
    const remembered = calls.get(sid);
    if (remembered) {
      remembered.finished = false;
      remembered.sealed = sealed;
      remembered.at = now().getTime();
    }

    const heard = (params['SpeechResult'] ?? '').trim();
    if (heard === '') {
      if (state.quiet >= 1) {
        finish(sid);
        return reply(
          response,
          goodbye("I can't hear anything, so I'll say goodbye for now. Ring again any time."),
        );
      }
      return reply(
        response,
        ask(
          "Sorry, I didn't hear anything. Please say that again.",
          next({ ...state, quiet: state.quiet + 1 }, sid),
        ),
      );
    }

    if (wantsToStop(heard) && state.step !== 'items') {
      finish(sid);
      return reply(response, goodbye('All right, nothing has been ordered. Goodbye.'));
    }

    switch (state.step) {
      case 'consent': {
        const answer = parseYesNo(heard);
        if (answer === null) {
          return reply(
            response,
            ask(
              'Sorry, was that a yes or a no? May I keep your number, just for this call?',
              next({ ...state, quiet: 0 }, sid),
            ),
          );
        }
        if (remembered) remembered.finished = answer === 'no';
        return reply(
          response,
          ask(
            answer === 'yes'
              ? 'Thank you. What is your first name and your surname?'
              : "That's fine, I won't keep it. What is your first name and your surname?",
            next({ ...state, step: 'name', callBack: answer === 'yes', quiet: 0 }, sid),
          ),
        );
      }

      case 'name': {
        const name = heard
          .replace(/^(my name is|my name's|it's|it is|i'm|i am|this is)\s+/i, '')
          .replace(/[.!?]+$/, '')
          .trim()
          .slice(0, 60);
        finish(sid);
        const phone = remembered?.phone ?? ukPhone(params['From'] ?? '') ?? '';
        const texted = phone ? await textLink(phone, name) : false;
        return reply(
          response,
          goodbye(
            `Thank you, ${firstName(name)}. To order by phone you need an account with a card, added once on the website, by you or someone you trust. A card is never given to me on a call. ` +
              (texted
                ? "I've sent you a text with the link. "
                : `The website is ${(env.primaryOrigin ?? '').replace(/^https?:\/\//, '')}. `) +
              'Once it is set up, ring this number and I will take your order. Goodbye.',
          ),
        );
      }

      case 'items': {
        if (wantsToStop(heard)) {
          finish(sid);
          return reply(response, goodbye('All right, nothing has been ordered. Goodbye.'));
        }
        if (REPEAT.test(heard)) {
          if (state.lines.length === 0) {
            return reply(
              response,
              ask('What would you like from the shop?', next({ ...state, quiet: 0 }, sid)),
            );
          }
          const { words } = await readBack(state.lines);
          return reply(response, more(state, sid, `So far you have ${words}.`));
        }

        // "Take off the milk."
        const removing = REMOVE.exec(heard);
        if (removing && state.lines.length > 0 && !DONE.test(heard)) {
          const wanted = thingAskedFor(removing[4] ?? '');
          const items = await repository.catalogue.findManyByIds(state.lines.map(([id]) => id));
          const gone = items.find((item) => item.name.toLowerCase().includes(wanted));
          if (gone) {
            const lines = state.lines.filter(([id]) => id !== gone.id);
            if (lines.length === 0) {
              return reply(
                response,
                ask(
                  `I've taken off the ${gone.name}. Your basket is empty. What would you like?`,
                  next({ ...state, lines, quiet: 0 }, sid),
                ),
              );
            }
            return reply(
              response,
              more({ ...state, lines }, sid, `I've taken off the ${gone.name}.`),
            );
          }
        }

        if (DONE.test(heard)) {
          if (state.lines.length === 0) {
            finish(sid);
            return reply(
              response,
              goodbye("There's nothing in your basket, so nothing has been ordered. Goodbye."),
            );
          }
          return reply(response, await confirmTwiml(state, sid));
        }

        const { items: asked } = splitItems(heard, config.assistantName);
        const added: string[] = [];
        const missing: string[] = [];
        const lines = [...state.lines];
        for (const phrase of asked) {
          const wanted = thingAskedFor(phrase);
          if (wanted === '') continue;
          const quantity = parseQuantity(phrase) ?? 1;
          let found = await repository.catalogue.search(wanted, {
            includeAgeRestricted: false,
            limit: 20,
          });
          if (found.length === 0 && wanted.endsWith('s')) {
            found = await repository.catalogue.search(wanted.slice(0, -1), {
              includeAgeRestricted: false,
              limit: 20,
            });
          }
          const item = bestMatch(found, wanted);
          if (!item) {
            missing.push(wanted);
            continue;
          }
          const existing = lines.findIndex(([id]) => id === item.id);
          if (existing >= 0)
            lines[existing] = [item.id, Math.min(99, lines[existing]![1] + quantity)];
          else lines.push([item.id, quantity]);
          added.push(
            `${quantity} ${item.name}, about ${money(item.estimatedPricePence * quantity)}`,
          );
        }
        const notFound = missing.length > 0 ? ` I couldn't find ${listWords(missing)}.` : '';
        if (added.length === 0) {
          return reply(
            response,
            ask(
              `Sorry,${notFound || " I didn't catch that."} Please say what you would like, for example: a loaf of bread.`,
              next({ ...state, lines, quiet: 0 }, sid),
            ),
          );
        }
        return reply(
          response,
          more({ ...state, lines }, sid, `I've added ${listWords(added)}.${notFound}`),
        );
      }

      case 'confirm': {
        const answer = parseYesNo(heard);
        if (answer === 'no') {
          return reply(
            response,
            more(
              state,
              sid,
              'All right, nothing has been sent. You can add something, or say take off and the item.',
            ),
          );
        }
        if (answer !== 'yes') {
          return reply(response, await confirmTwiml(state, sid, 'Sorry, was that a yes or a no?'));
        }
        finish(sid);
        return reply(response, await placeOrder(state, sid));
      }
    }
  });

  /** The order read back slowly: everything, the cost, the card and the address. */
  async function confirmTwiml(state: CallState, sid: string, opening = ''): Promise<string> {
    const shopper = state.shopperId ? await repository.shoppers.findById(state.shopperId) : null;
    if (!shopper)
      return goodbye('Sorry, I could not find your account. Please ring again. Goodbye.');
    const { priced, words } = await readBack(state.lines);
    const ceiling = config.voice.paymentCeilingPence;
    if (priced.totalPence > ceiling) {
      return ask(
        `That comes to ${money(priced.totalPence)}, and the most I can take by phone is ${money(ceiling)}. Please say take off and something, or say cancel.`,
        next({ ...state, step: 'items', quiet: 0 }, sid),
      );
    }
    const cards = await repository.paymentMethods.listForShopper(shopper.id);
    const card = cards[0];
    return ask(
      `${opening ? `${opening} ` : ''}Here is your order. ${words}. The shopping comes to about ${money(priced.goodsPence)}. Delivery is ${money(priced.feePence)}. So the total is about ${money(priced.totalPence)}, taken from your card ending ${card?.lastFour.split('').join(' ') ?? ''}. You pay what the till says for the shopping. It goes to your home address: ${shopper.deliveryAddress}. Shall I send it? Say yes or no.`,
      next({ ...state, step: 'confirm', agreedTotalPence: priced.totalPence, quiet: 0 }, sid),
    );
  }

  /** The order goes through exactly the checks an order in the app goes through. */
  async function placeOrder(state: CallState, sid: string): Promise<string> {
    const shopper = state.shopperId ? await repository.shoppers.findById(state.shopperId) : null;
    const cards = shopper ? await repository.paymentMethods.listForShopper(shopper.id) : [];
    if (!shopper || !cards[0] || state.agreedTotalPence === undefined) {
      return goodbye(
        'Sorry, I could not send that. Nothing has been charged. Please ring again. Goodbye.',
      );
    }
    const { words } = await readBack(state.lines);
    const token = signSession(
      {
        accountId: shopper.id,
        role: 'shopper',
        expiresAt: Math.floor(now().getTime() / 1000) + 120,
      },
      env.authTokenSecret,
    );
    const placed = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        lines: state.lines.map(([catalogueItemId, quantity]) => ({ catalogueItemId, quantity })),
        deliveryAddress: shopper.deliveryAddress,
        paymentMethodId: cards[0].id,
        confirmation: {
          confirmed: true,
          channel: 'voice',
          addressConfirmed: true,
          statement:
            `By telephone: yes to ${words}, about ${money(state.agreedTotalPence)}, to the home address.`.slice(
              0,
              400,
            ),
          agreedTotalPence: state.agreedTotalPence,
        },
      },
    });
    const body = placed.json() as {
      message?: string;
      payment?: { requiresAction?: boolean };
      error?: { message?: string };
    };
    if (placed.statusCode !== 201) {
      return goodbye(
        `${body.error?.message ?? 'Sorry, that did not go through. Nothing has been charged.'} Goodbye.`,
      );
    }
    if (body.payment?.requiresAction) {
      return goodbye(
        'Your bank wants to check it is really you before the money is taken, and that can only be done in the app or on the website. Nothing has been taken yet. Please ask someone you trust to help, or ring us. Goodbye.',
      );
    }
    const texts =
      isUkMobile(shopper.phone) && app.ctx.sendText
        ? " I'll text you as your order goes along."
        : '';
    app.log.info({ sid }, 'A telephone order was placed.');
    return goodbye(
      `${body.message ?? 'Thank you. Your order is on its way to a Runner.'}${texts} ${config.motto} Goodbye.`,
    );
  }

  /* -------------------------------------------------------------- cut off: ring back */

  app.post('/webhooks/twilio/status', async (request, response) => {
    const params = verified(request);
    if (!params) return refused(response);
    const sid = params['CallSid'] ?? '';
    const status = params['CallStatus'] ?? '';
    const call = calls.get(sid);
    if (
      call &&
      !call.finished &&
      !call.calledBack &&
      call.sealed &&
      ['completed', 'failed', 'no-answer', 'busy'].includes(status) &&
      app.ctx.placeCall
    ) {
      const state = openState(call.sealed, env.authTokenSecret, now());
      if (state?.callBack) {
        call.calledBack = true;
        await app.ctx
          .placeCall(
            call.phone,
            `${base()}/voice?s=${encodeURIComponent(call.sealed)}`,
            `${base()}/status`,
          )
          .catch((failure: unknown) => {
            app.log.warn({ err: failure }, 'Could not ring a caller back.');
          });
      }
    }
    if (call && ['completed', 'failed', 'no-answer', 'busy', 'canceled'].includes(status)) {
      call.finished = true;
    }
    return response.status(204).send();
  });

  /* -------------------------------------------------------------- a text to the number */

  app.post('/webhooks/twilio/sms', async (request, response) => {
    const params = verified(request);
    if (!params) return refused(response);
    const site = env.primaryOrigin ?? '';
    return reply(
      response,
      `<Response><Message>${escapeXml(
        `${config.productName}: texts to this number are not read. Ring it to order with ${config.assistantName}, or use ${site} . We will never ask for your card or a code by text.`,
      )}</Message></Response>`,
    );
  });
}
