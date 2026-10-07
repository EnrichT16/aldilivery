/**
 * Paid extras (6 and 7 October 2026): Ozi Recipes, Ozi Plus and the family plan, Ozi Finds It
 * and gift cards; and organisations asking to work with us.
 *
 * Rule One: every price is said and agreed before anything is taken, and the agreement travels
 * with the request. Nothing renews by itself: when the days run out, it is simply off again.
 * Rule Four: none of this ever changes the delivery fee.
 */

import { randomInt } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { formatPence } from '@aldilivery/core';
import { z } from 'zod';

import { requireSession } from '../app.js';
import { staffActor } from '../lib/staff.js';
import type { FindRequest, GiftCard, Shopper } from '../domain.js';
import { BadRequestError, ConflictError, NotFoundError, UnavailableError } from '../errors.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Letters and numbers nobody mixes up when reading or saying them: no O, 0, I, 1 or L. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(length: number): string {
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** "abcd efgh-jkmn" and "ABCDEFGHJKMN" are the same card: ABCD-EFGH-JKMN. */
export function normaliseGiftCode(said: string): string {
  const letters = said.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return letters.match(/.{1,4}/g)?.join('-') ?? '';
}

/** Things never brought (Section K), so never looked for either. */
const NEVER_FOUND =
  /\b(alcohol|wine|beer|lager|cider|spirits?|vodka|whisky|whiskey|gin|rum|prosecco|champagne|cigarettes?|cigars?|tobacco|vapes?|vaping|e-?cig|lighter fluid|medicines?|medication|paracetamol|ibuprofen|aspirin|pills|tablets|prescriptions?|cash|knife|knives|blades?|fireworks|lottery|scratch ?cards?)\b/i;

function longDate(when: Date): string {
  return when.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/London',
  });
}

export async function registerExtrasRoutes(app: FastifyInstance): Promise<void> {
  const { repository, payments, config, now } = app.ctx;
  const symbol = config.store.currencySymbol;
  const money = (pence: number): string => formatPence(pence, symbol);
  const extras = config.extras;

  async function signedInShopper(request: FastifyRequest): Promise<Shopper> {
    const session = requireSession(request, 'shopper');
    const shopper = await repository.shoppers.findById(session.accountId);
    if (!shopper) throw new NotFoundError('account');
    return shopper;
  }

  function agreed(price: string) {
    return z.literal(true, {
      errorMap: () => ({ message: `Please agree to the price first: ${price}.` }),
    });
  }

  /**
   * Takes an agreed amount from the Shopper's saved card. Throws, having taken nothing, when
   * there is no card or the card is refused.
   */
  async function take(
    request: FastifyRequest,
    shopper: Shopper,
    amountPence: number,
    what: string,
    reference: string,
  ): Promise<{ id: string; lastFour: string }> {
    const cards = await repository.paymentMethods.listForShopper(shopper.id);
    const card = cards.find((method) => method.isDefault) ?? cards[0];
    if (!card) throw new ConflictError('Please save a card first. Nothing has been charged.');
    const at = now();
    try {
      const charge = await payments.chargeSavedCard({
        amountPence,
        currency: config.store.currency,
        paymentMethodId: card.stripePaymentMethodId,
        customerId: shopper.stripeCustomerId,
        description: `${config.productName} ${what}`,
        reference: `${reference}:${shopper.id}:${at.toISOString()}`,
        agreedAt: at.toISOString(),
      });
      if (!charge.id) throw new Error('No payment reference came back.');
      return { id: charge.id, lastFour: card.lastFour };
    } catch (failure) {
      request.log.warn({ err: failure, what }, 'An extra could not be charged');
      throw new UnavailableError(
        `The card could not be charged just now, so nothing was taken. Please try again, or use another card.`,
      );
    }
  }

  function plusActive(shopper: Shopper): boolean {
    return shopper.plusUntil !== null && shopper.plusUntil.getTime() > now().getTime();
  }

  /** Recipes stays open at least as long as Plus does: Plus includes it. */
  function laterOf(a: Date | null, b: Date): Date {
    return a && a.getTime() > b.getTime() ? a : b;
  }

  /* ------------------------------------------------------------------ Ozi Recipes */

  app.post('/extras/recipe-pass', async (request) => {
    const { recipePassPence, recipePassDays } = extras;
    const price = money(recipePassPence);
    z.object({ priceAccepted: agreed(price) }).parse(request.body ?? {});
    const shopper = await signedInShopper(request);

    const at = now();
    const from = laterOf(shopper.recipePassUntil, at);
    const until = new Date(from.getTime() + recipePassDays * DAY_MS);
    const card = await take(
      request,
      shopper,
      recipePassPence,
      `Recipes, ${recipePassDays} days`,
      'recipe-pass',
    ).catch((failure: unknown) => {
      if (failure instanceof UnavailableError) {
        throw new UnavailableError(
          'The card could not be charged just now, so Recipes is not unlocked and nothing was taken. Please try again, or use another card.',
        );
      }
      throw failure;
    });

    await repository.shoppers.update(shopper.id, { recipePassUntil: until });
    return {
      recipePassUntil: until,
      message: `Recipes is unlocked until ${longDate(until)}. ${price} was taken from your card ending ${card.lastFour}. It does not renew by itself.`,
    };
  });

  /* ------------------------------------------------------------------ Ozi Plus */

  async function plusState(shopper: Shopper) {
    const owner =
      shopper.familyOwnerId !== null
        ? await repository.shoppers.findById(shopper.familyOwnerId)
        : null;
    const members = shopper.plusFamily ? await repository.shoppers.listFamily(shopper.id) : [];
    return {
      active: plusActive(shopper),
      plusUntil: shopper.plusUntil,
      family: shopper.plusFamily,
      familyCode: shopper.plusFamily ? shopper.familyCode : null,
      members: members.map((member) => member.displayName),
      joinedFamilyOf: owner?.displayName ?? null,
      familyMaximum: extras.familyMaximum,
      creditPence: shopper.creditPence,
    };
  }

  app.get('/extras/plus', async (request) => {
    const shopper = await signedInShopper(request);
    return plusState(shopper);
  });

  app.post('/extras/plus', async (request) => {
    const body = z
      .object({ plan: z.enum(['single', 'family']), priceAccepted: z.literal(true).optional() })
      .parse(request.body ?? {});
    const family = body.plan === 'family';
    const pricePence = family ? extras.plusFamilyPence : extras.plusPence;
    const price = money(pricePence);
    z.object({ priceAccepted: agreed(price) }).parse(request.body ?? {});
    const shopper = await signedInShopper(request);
    if (shopper.familyOwnerId !== null) {
      throw new ConflictError(
        'You are already on a family plan, so you have Plus already. To buy your own, leave the family plan first.',
      );
    }

    const at = now();
    const until = new Date(laterOf(shopper.plusUntil, at).getTime() + extras.plusDays * DAY_MS);
    const name = family ? 'Plus for a family' : 'Plus';
    const card = await take(
      request,
      shopper,
      pricePence,
      `${name}, ${extras.plusDays} days`,
      'plus',
    );

    let familyCode = shopper.familyCode;
    if (family && !familyCode) {
      do {
        familyCode = randomCode(6);
      } while (await repository.shoppers.findByFamilyCode(familyCode));
    }
    const updated = await repository.shoppers.update(shopper.id, {
      plusUntil: until,
      // The plan just bought decides: a single plan does not carry a family along with it.
      plusFamily: family,
      familyCode,
      recipePassUntil: laterOf(shopper.recipePassUntil, until),
    });
    // On a family plan, everybody who joined gets the new date too.
    for (const member of family ? await repository.shoppers.listFamily(shopper.id) : []) {
      await repository.shoppers.update(member.id, {
        plusUntil: until,
        recipePassUntil: laterOf(member.recipePassUntil, until),
      });
    }

    const share =
      family && familyCode
        ? ` To add up to ${extras.familyMaximum - 1} more people, give them your family code: ${familyCode}.`
        : '';
    return {
      ...(await plusState(updated)),
      message: `${config.assistantName} ${name} is on until ${longDate(until)}. ${price} was taken from your card ending ${card.lastFour}. It does not renew by itself.${share}`,
    };
  });

  app.post('/extras/family/join', async (request) => {
    const { code } = z
      .object({ code: z.string().trim().min(4, 'Please give the family code.').max(20) })
      .parse(request.body ?? {});
    const shopper = await signedInShopper(request);
    const owner = await repository.shoppers.findByFamilyCode(
      code.toUpperCase().replace(/[^A-Z0-9]/g, ''),
    );
    if (!owner || !owner.plusFamily || !plusActive(owner)) {
      throw new NotFoundError('family plan with that code');
    }
    if (owner.id === shopper.id) {
      throw new BadRequestError(
        'That is your own family code. Give it to the people you want to add.',
      );
    }
    const members = await repository.shoppers.listFamily(owner.id);
    if (
      !members.some((member) => member.id === shopper.id) &&
      members.length + 1 >= extras.familyMaximum
    ) {
      throw new ConflictError(
        `That family plan is full: it is for up to ${extras.familyMaximum} people.`,
      );
    }
    const updated = await repository.shoppers.update(shopper.id, {
      familyOwnerId: owner.id,
      plusUntil: owner.plusUntil,
      recipePassUntil: laterOf(shopper.recipePassUntil, owner.plusUntil ?? now()),
    });
    return {
      ...(await plusState(updated)),
      message: `You've joined ${owner.displayName}'s family plan. You have ${config.assistantName} Plus until ${longDate(owner.plusUntil ?? now())}.`,
    };
  });

  app.post('/extras/family/leave', async (request) => {
    const shopper = await signedInShopper(request);
    if (shopper.familyOwnerId === null) {
      throw new BadRequestError('You are not on anybody else’s family plan.');
    }
    const updated = await repository.shoppers.update(shopper.id, {
      familyOwnerId: null,
      plusUntil: null,
    });
    return { ...(await plusState(updated)), message: 'You have left the family plan.' };
  });

  /* ------------------------------------------------------------------ Ozi Finds It */

  function publicFind(row: FindRequest) {
    return {
      id: row.id,
      description: row.description,
      feePence: row.feePence,
      status: row.status,
      foundName: row.foundName,
      foundShop: row.foundShop,
      foundPricePence: row.foundPricePence,
      catalogueItemId: row.catalogueItemId,
      note: row.note,
      createdAt: row.createdAt,
      decidedAt: row.decidedAt,
    };
  }

  app.get('/extras/find-it', async (request) => {
    const shopper = await signedInShopper(request);
    const requests = await repository.findRequests.listForShopper(shopper.id);
    return { requests: requests.map(publicFind) };
  });

  app.post('/extras/find-it', async (request, reply) => {
    const shopper = await signedInShopper(request);
    const covered = plusActive(shopper);
    const price = money(extras.findItPence);
    const body = z
      .object({
        description: z
          .string()
          .trim()
          .min(3, 'Please say what you are looking for.')
          .max(300, 'Please keep it shorter.'),
        priceAccepted: covered ? z.boolean().optional() : agreed(price),
      })
      .parse(request.body ?? {});
    if (NEVER_FOUND.test(body.description)) {
      throw new BadRequestError(
        `We can't look for that: ${config.productName} never brings alcohol, tobacco, medicines, cash or anything age restricted. Nothing has been charged.`,
      );
    }
    const charge = covered
      ? null
      : await take(request, shopper, extras.findItPence, 'Finds It', 'find-it');
    const row = await repository.findRequests.create({
      shopperId: shopper.id,
      description: body.description,
      feePence: covered ? 0 : extras.findItPence,
      chargeId: charge?.id ?? null,
    });
    void reply.status(201);
    return {
      request: publicFind(row),
      message:
        `Thank you. A person will look for ${body.description} in up to ${extras.findItShops} shops, and tell you here what they find and the price. ` +
        (charge
          ? `${price} was taken from your card ending ${charge.lastFour}, and it comes back if it can't be found.`
          : `It's included in your ${config.assistantName} Plus.`),
    };
  });

  app.get('/staff/find-it', async (request) => {
    await staffActor(request, 'finds');
    const looking = await repository.findRequests.listLooking();
    const rows = [];
    for (const row of looking) {
      const shopper = await repository.shoppers.findById(row.shopperId);
      rows.push({
        ...publicFind(row),
        shopperName: shopper?.displayName ?? '',
        // The area only, to choose shops near them: never the whole address, never a number.
        area: (shopper?.deliveryAddress ?? '').split(',').slice(-1)[0]?.trim() ?? '',
      });
    }
    return { requests: rows, shops: extras.findItShops };
  });

  app.post('/staff/find-it/:id/decide', async (request) => {
    await staffActor(request, 'finds');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .discriminatedUnion('found', [
        z.object({
          found: z.literal(true),
          name: z.string().trim().min(2).max(120),
          shop: z.string().trim().min(2).max(80),
          pricePence: z.number().int().min(1).max(100_000),
          note: z.string().trim().max(300).optional(),
        }),
        z.object({
          found: z.literal(false),
          note: z.string().trim().max(300).optional(),
        }),
      ])
      .parse(request.body ?? {});
    const row = await repository.findRequests.findById(id);
    if (!row) throw new NotFoundError('find request');
    if (row.status !== 'looking') throw new ConflictError('That one has already been decided.');

    if (body.found) {
      if (NEVER_FOUND.test(body.name)) {
        throw new BadRequestError('That is something we never bring, so it cannot be added.');
      }
      // It goes in the catalogue, so the Shopper can put it in their basket like anything else.
      const item = await repository.catalogue.create({
        name: `${body.name} (from ${body.shop})`,
        category: 'Found for you',
        estimatedPricePence: body.pricePence,
        source: 'community',
      });
      const updated = await repository.findRequests.update(row.id, {
        status: 'found',
        foundName: body.name,
        foundShop: body.shop,
        foundPricePence: body.pricePence,
        catalogueItemId: item.id,
        note: body.note ?? null,
        decidedAt: now(),
      });
      return { request: publicFind(updated), item };
    }

    let refundId: string | null = null;
    if (row.chargeId) {
      refundId = (
        await payments.refundPayment({
          paymentIntentId: row.chargeId,
          amountPence: row.feePence,
          reference: `find-it:${row.id}`,
        })
      ).id;
    }
    const updated = await repository.findRequests.update(row.id, {
      status: 'not_found',
      refundId,
      note: body.note ?? null,
      decidedAt: now(),
    });
    return { request: publicFind(updated) };
  });

  /* ------------------------------------------------------------------ gift cards */

  function publicGiftCard(card: GiftCard) {
    return {
      code: card.code,
      amountPence: card.amountPence,
      recipientName: card.recipientName,
      message: card.message,
      used: card.redeemedByShopperId !== null,
      createdAt: card.createdAt,
    };
  }

  app.get('/extras/gift-cards', async (request) => {
    const shopper = await signedInShopper(request);
    const bought = await repository.giftCards.listBoughtBy(shopper.id);
    return {
      amountsPence: extras.giftCardPence,
      creditPence: shopper.creditPence,
      bought: bought.map(publicGiftCard),
    };
  });

  app.post('/extras/gift-cards', async (request, reply) => {
    const body = z
      .object({
        amountPence: z
          .number()
          .int()
          .refine((value) => extras.giftCardPence.includes(value), {
            message: `A gift card can be ${extras.giftCardPence.map(money).join(', ')}.`,
          }),
        recipientName: z.string().trim().max(60).default(''),
        message: z.string().trim().max(200).default(''),
        priceAccepted: z.literal(true).optional(),
      })
      .parse(request.body ?? {});
    const price = money(body.amountPence);
    z.object({ priceAccepted: agreed(price) }).parse(request.body ?? {});
    const shopper = await signedInShopper(request);

    let code: string;
    do {
      code = normaliseGiftCode(randomCode(12));
    } while (await repository.giftCards.findByCode(code));
    const charge = await take(
      request,
      shopper,
      body.amountPence,
      `gift card ${price}`,
      'gift-card',
    );
    const card = await repository.giftCards.create({
      code,
      amountPence: body.amountPence,
      buyerShopperId: shopper.id,
      chargeId: charge.id,
      recipientName: body.recipientName,
      message: body.message,
    });
    void reply.status(201);
    return {
      giftCard: publicGiftCard(card),
      message: `Here is your ${price} gift card. The code is ${code}. ${price} was taken from your card ending ${charge.lastFour}. Whoever you give it to opens Gift cards in ${config.productName} and types the code.`,
    };
  });

  app.post('/extras/gift-cards/redeem', async (request) => {
    const { code } = z
      .object({ code: z.string().trim().min(4, 'Please type the gift card code.').max(30) })
      .parse(request.body ?? {});
    const shopper = await signedInShopper(request);
    const card = await repository.giftCards.findByCode(normaliseGiftCode(code));
    if (!card) throw new NotFoundError('gift card with that code');
    const used = await repository.giftCards.redeem(card.id, shopper.id, now());
    if (!used) throw new ConflictError('That gift card has already been used.');
    const updated = await repository.shoppers.update(shopper.id, {
      creditPence: shopper.creditPence + card.amountPence,
    });
    return {
      creditPence: updated.creditPence,
      message: `${money(card.amountPence)} has been added. You have ${money(updated.creditPence)} to spend. It comes off your next order: you pay by card as usual, and it goes straight back to your card once the order is paid.`,
    };
  });

  /* ------------------------------------------------------------------ organisations */

  app.post('/organisations/enquiries', async (request, reply) => {
    const body = z
      .object({
        organisation: z.string().trim().min(2, 'Please give the organisation’s name.').max(120),
        contactName: z.string().trim().min(2, 'Please give your name.').max(80),
        telephone: z.string().trim().min(6, 'Please give a telephone number.').max(30),
        email: z.string().trim().max(120).default(''),
        people: z.string().trim().max(60).default(''),
        message: z.string().trim().max(1000).default(''),
      })
      .parse(request.body ?? {});
    await repository.organisationEnquiries.create(body);
    void reply.status(201);
    return {
      message: `Thank you, ${body.contactName}. A person from ${config.productName} will ring you within two working days.`,
    };
  });

  app.get('/staff/enquiries', async (request) => {
    await staffActor(request, 'enquiries');
    return { enquiries: await repository.organisationEnquiries.list() };
  });

  app.post('/staff/enquiries/:id/handled', async (request) => {
    await staffActor(request, 'enquiries');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const enquiries = await repository.organisationEnquiries.list();
    if (!enquiries.some((row) => row.id === id)) throw new NotFoundError('enquiry');
    return { enquiry: await repository.organisationEnquiries.update(id, { handled: true }) };
  });
}
