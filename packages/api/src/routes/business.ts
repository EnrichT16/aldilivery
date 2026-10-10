/**
 * Partner shops and organisations (7 October 2026, ruling 41).
 *
 * A partner shop pays monthly for its own sign-in, where it keeps its own products and prices
 * (each new product approved by a person before Shoppers see it), its own page in the app, and
 * a link to share. An organisation signs in to see what the people it supports have ordered,
 * who in the organisation looks after them, what it has spent and saved, and what is coming.
 * Each kind of account has its own sign-in and sees only its own things.
 */

import { randomInt } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { displayPricePence, formatPence, organisationMonthlyPence } from '@aldilivery/core';
import { z } from 'zod';

import { requireSession } from '../app.js';
import { hasPlusExtras } from '../services/plans.js';
import type {
  BusinessKind,
  BusinessUser,
  Order,
  PartnerPayment,
  PartnerProduct,
  PartnerShop,
} from '../domain.js';
import { BadRequestError, ConflictError, NotFoundError, UnauthorisedError } from '../errors.js';
import { businessActor, BUSINESS_SESSION_HOURS, signBusinessToken } from '../lib/business.js';
import { textPdf } from '../lib/pdf.js';
import { NEVER_FOUND } from '../lib/restricted.js';
import { chooseAdvert, spotlightActive } from '../lib/spotlight.js';
import { hashPassword, passwordMatches, staffActor, temporaryPassword } from '../lib/staff.js';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const ATTEMPTS = 5;
const LOCK_MINUTES = 15;

/** Easy to read out: no O, 0, I, 1 or L. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Orders that were really paid for, as opposed to drafts, refused cards and cancellations. */
const PAID_STATUSES = new Set([
  'paid',
  'offered',
  'accepted',
  'shopping',
  'receipt_submitted',
  'delivering',
  'delivered',
  'completed',
  'refunded',
]);

const PAYMENT_WORDS: Record<PartnerPayment['kind'], string> = {
  plan: 'Shop Partner plan',
  spotlight: 'Spotlight',
  plus: 'Spotlight Plus',
};

/** A file name with nothing a browser or a computer would object to. */
function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9 .-]/g, '').trim() || 'statement';
}

function paidAmount(order: Order): number {
  return (order.finalTotalPence ?? order.totalEstimatePence) - order.creditAppliedPence;
}

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9.]{2,29}$/, 'A username is 3 to 30 letters, numbers or dots.');

export async function registerBusinessRoutes(app: FastifyInstance): Promise<void> {
  const { repository, env, config, now } = app.ctx;
  const money = (pence: number): string => formatPence(pence, config.store.currencySymbol);

  function monthStart(): Date {
    const at = now();
    return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  }

  function longDay(when: Date): string {
    return when.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/London',
    });
  }

  function publicPayment(row: PartnerPayment) {
    return {
      id: row.id,
      kind: row.kind,
      what: PAYMENT_WORDS[row.kind],
      amountPence: row.amountPence,
      months: row.months,
      coversUntil: row.coversUntil,
      paidAt: row.paidAt,
    };
  }

  /** How the shop is doing: purchases from it this week and this month (business analysis). */
  async function shopNumbers(shopName: string) {
    const at = now();
    const events = (
      await repository.analytics.list({
        since: new Date(at.getTime() - 30 * 24 * 60 * 60 * 1000),
        kind: 'order_paid',
      })
    ).filter((event) => event.shop === shopName);
    const week = events.filter(
      (event) => event.at.getTime() > at.getTime() - 7 * 24 * 60 * 60 * 1000,
    );
    return {
      purchasesThisWeek: week.length,
      purchasesThisMonth: events.length,
      itemsThisMonth: events.reduce((sum, event) => sum + event.itemCount, 0),
    };
  }

  /** How many people opened an account through this share link. */
  async function countJoinedVia(via: string): Promise<number> {
    return repository.shoppers.countJoinedVia(via);
  }

  function planPaid(shop: PartnerShop): boolean {
    return shop.active && shop.paidUntil !== null && shop.paidUntil.getTime() > now().getTime();
  }

  function publicProduct(product: PartnerProduct) {
    return {
      id: product.id,
      name: product.name,
      pricePence: product.pricePence,
      tags: product.tags,
      expiresOn: product.expiresOn,
      hasPhoto: product.photo !== null,
      status: product.status,
      note: product.note,
      catalogueItemId: product.catalogueItemId,
      createdAt: product.createdAt,
    };
  }

  async function newUser(
    kind: BusinessKind,
    owner: { partnerShopId?: string; organisationId?: string },
    input: { name: string; username: string; office?: string },
  ) {
    if (await repository.businessUsers.findByUsername(input.username)) {
      throw new ConflictError('That username is taken. Please choose another.');
    }
    const password = temporaryPassword();
    const user = await repository.businessUsers.create({
      kind,
      partnerShopId: owner.partnerShopId ?? null,
      organisationId: owner.organisationId ?? null,
      name: input.name,
      office: input.office ?? '',
      username: input.username,
      passwordHash: hashPassword(password),
    });
    return {
      user: { id: user.id, name: user.name, username: user.username, office: user.office },
      password,
      message: `${user.name} can now sign in as ${user.username} with the password ${password}. They choose their own the first time. This is shown only once.`,
    };
  }

  /* ------------------------------------------------------------------ signing in */

  app.post('/business/sign-in', async (request) => {
    const body = z
      .object({
        username: z.string().trim().toLowerCase().min(1, 'Please give your username.').max(40),
        password: z.string().min(1, 'Please give your password.').max(200),
      })
      .parse(request.body ?? {});
    const user = await repository.businessUsers.findByUsername(body.username);
    const refused = new UnauthorisedError('That username and password do not match.');
    if (!user || !user.active) throw refused;
    const at = now();
    if (user.lockedUntil && user.lockedUntil.getTime() > at.getTime()) {
      throw new UnauthorisedError(
        `Too many wrong passwords. Please wait ${LOCK_MINUTES} minutes, or ask us to reset it.`,
      );
    }
    if (!passwordMatches(body.password, user.passwordHash)) {
      const failed = user.failedAttempts + 1;
      await repository.businessUsers.update(user.id, {
        failedAttempts: failed >= ATTEMPTS ? 0 : failed,
        lockedUntil: failed >= ATTEMPTS ? new Date(at.getTime() + LOCK_MINUTES * 60_000) : null,
      });
      throw refused;
    }
    await repository.businessUsers.update(user.id, {
      failedAttempts: 0,
      lockedUntil: null,
      lastSignInAt: at,
    });
    return {
      token: signBusinessToken(
        user.id,
        new Date(at.getTime() + BUSINESS_SESSION_HOURS * 3_600_000),
        env.authTokenSecret,
      ),
      ...(await describe(user)),
    };
  });

  async function describe(user: BusinessUser) {
    const business =
      user.kind === 'partner' && user.partnerShopId
        ? (await repository.partnerShops.findById(user.partnerShopId))?.name
        : user.organisationId
          ? (await repository.organisations.findById(user.organisationId))?.name
          : null;
    return {
      kind: user.kind,
      name: user.name,
      office: user.office,
      business: business ?? '',
      mustChangePassword: user.mustChangePassword,
    };
  }

  app.get('/business/me', async (request) => describe(await businessActor(request)));

  app.post('/business/password', async (request) => {
    const user = await businessActor(request);
    const body = z
      .object({
        current: z.string().min(1).max(200),
        password: z
          .string()
          .min(10, 'Please choose a password of at least 10 characters.')
          .max(200),
      })
      .parse(request.body ?? {});
    if (!passwordMatches(body.current, user.passwordHash)) {
      throw new UnauthorisedError('Your current password was not right.');
    }
    await repository.businessUsers.update(user.id, {
      passwordHash: hashPassword(body.password),
      mustChangePassword: false,
    });
    return { message: 'Your password is changed.' };
  });

  /* ------------------------------------------------------------------ partner shops */

  async function myShop(request: Parameters<typeof businessActor>[0]): Promise<PartnerShop> {
    const user = await businessActor(request, 'partner');
    const shop = user.partnerShopId
      ? await repository.partnerShops.findById(user.partnerShopId)
      : null;
    if (!shop) throw new NotFoundError('partner shop');
    return shop;
  }

  app.get('/partner/dashboard', async (request) => {
    const shop = await myShop(request);
    const products = (await repository.partnerProducts.listForShop(shop.id)).filter(
      (product) => product.status !== 'removed',
    );
    return {
      shop: {
        id: shop.id,
        name: shop.name,
        address: shop.address,
        telephone: shop.telephone,
        about: shop.about,
      },
      plan: {
        monthlyPence: shop.monthlyPence,
        paidUntil: shop.paidUntil,
        paid: planPaid(shop),
      },
      counts: {
        live: products.filter((product) => product.status === 'approved').length,
        waiting: products.filter((product) => product.status === 'pending').length,
        notAccepted: products.filter((product) => product.status === 'rejected').length,
      },
      products: products.map(publicProduct),
      sharePath: `/shops/${shop.id}`,
      spotlight: {
        level: spotlightActive(shop, now()) ? shop.spotlight : 'none',
        until: shop.spotlightUntil,
        mentionsThisMonth: await repository.spotlightMentions.countForShopSince(
          shop.id,
          monthStart(),
        ),
        prices: {
          spotlightPence: config.extras.spotlightPence,
          plusPence: config.extras.spotlightPlusPence,
          spotlightPerWeek: config.extras.spotlightPerWeek,
          plusPerWeek: config.extras.spotlightPlusPerWeek,
        },
      },
      payments: (await repository.partnerPayments.listForShop(shop.id)).map(publicPayment),
      referrals: await countJoinedVia(`partner:${shop.id}`),
      numbers: await shopNumbers(shop.name),
    };
  });

  app.get('/partner/statement.pdf', async (request, reply) => {
    const shop = await myShop(request);
    const payments = await repository.partnerPayments.listForShop(shop.id);
    const total = payments.reduce((sum, row) => sum + row.amountPence, 0);
    const lines = [
      `${shop.name}`,
      `Statement from ${config.productName}, ${longDay(now())}.`,
      '',
      ...(payments.length === 0
        ? ['No payments recorded yet.']
        : payments.map(
            (row) =>
              `${longDay(row.paidAt)}: ${PAYMENT_WORDS[row.kind]}, ${row.months} month${row.months === 1 ? '' : 's'}, ${money(row.amountPence)}. Covers until ${longDay(row.coversUntil)}.`,
          )),
      '',
      `Total paid: ${money(total)}.`,
      `Plan: ${money(shop.monthlyPence)} a month${shop.paidUntil ? `, paid until ${longDay(shop.paidUntil)}` : ''}.`,
    ];
    void reply.header('content-type', 'application/pdf');
    void reply.header(
      'content-disposition',
      `attachment; filename="${safeName(shop.name)} statement.pdf"`,
    );
    return reply.send(textPdf(`${config.productName} statement`, lines));
  });

  app.post('/partner/products', { bodyLimit: 7 * 1024 * 1024 }, async (request, reply) => {
    const shop = await myShop(request);
    if (!planPaid(shop)) {
      throw new ConflictError(
        `Your monthly plan is not active, so new products cannot be added. Please speak to us to renew it: ${money(shop.monthlyPence)} a month.`,
      );
    }
    const body = z
      .object({
        name: z.string().trim().min(2, 'Please say what the product is.').max(120),
        pricePence: z.number().int().min(1, 'Please give the price.').max(100_000),
        tags: z.string().trim().max(200).default(''),
        expiresOn: z.string().date('Please give the date as day, month and year.').optional(),
        photo: z
          .string()
          .max(6 * 1024 * 1024)
          .optional(),
        photoType: z.string().max(40).optional(),
      })
      .parse(request.body ?? {});
    if (NEVER_FOUND.test(`${body.name} ${body.tags}`)) {
      throw new BadRequestError(
        `${config.productName} never brings alcohol, tobacco, medicines, cash or anything age restricted, so that cannot be listed.`,
      );
    }
    let photo: Buffer | null = null;
    if (body.photo) {
      if (!body.photoType || !IMAGE_TYPES.includes(body.photoType)) {
        throw new BadRequestError('Please send a photo.');
      }
      photo = Buffer.from(body.photo, 'base64');
      if (photo.length === 0 || photo.length > MAX_PHOTO_BYTES) {
        throw new BadRequestError('That photo is empty or too large. Please take it again.');
      }
    }
    const product = await repository.partnerProducts.create({
      partnerShopId: shop.id,
      name: body.name,
      pricePence: body.pricePence,
      tags: body.tags,
      expiresOn: body.expiresOn ? new Date(`${body.expiresOn}T00:00:00Z`) : null,
      photo: photo ? new Uint8Array(photo) : null,
      photoType: photo ? (body.photoType ?? null) : null,
    });
    void reply.status(201);
    return {
      product: publicProduct(product),
      message: `Thank you. ${body.name}, ${money(body.pricePence)}, is waiting to be checked. It usually goes live within one working day.`,
    };
  });

  async function myProduct(request: Parameters<typeof businessActor>[0], id: string) {
    const shop = await myShop(request);
    const product = await repository.partnerProducts.findById(id);
    if (!product || product.partnerShopId !== shop.id || product.status === 'removed') {
      throw new NotFoundError('product');
    }
    return product;
  }

  /** A new price applies at once: prices are estimates, and the Shopper pays the till. */
  app.post('/partner/products/:id/price', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const { pricePence } = z
      .object({ pricePence: z.number().int().min(1).max(100_000) })
      .parse(request.body ?? {});
    const product = await myProduct(request, id);
    const updated = await repository.partnerProducts.update(product.id, { pricePence });
    if (product.catalogueItemId) {
      await repository.catalogue.update(product.catalogueItemId, {
        estimatedPricePence: pricePence,
        lastSeenAt: now(),
      });
    }
    return {
      product: publicProduct(updated),
      message: `${product.name} is now ${money(pricePence)}.`,
    };
  });

  app.post('/partner/products/:id/remove', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const product = await myProduct(request, id);
    await repository.partnerProducts.update(product.id, { status: 'removed' });
    if (product.catalogueItemId) {
      await repository.catalogue.update(product.catalogueItemId, { retired: true });
    }
    return { message: `${product.name} is taken off. Shoppers no longer see it.` };
  });

  app.get('/partner/products/:id/photo', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const product = await myProduct(request, id);
    if (!product.photo || !product.photoType) throw new NotFoundError('photo');
    void reply.header('content-type', product.photoType);
    void reply.header('cache-control', 'no-store');
    return reply.send(Buffer.from(product.photo));
  });

  /* ------------------------------------------------------------------ the public shop pages */

  app.get('/shops', async () => {
    const shops = (await repository.partnerShops.list()).filter(planPaid);
    const rows = [];
    for (const shop of shops) {
      const live = (await repository.partnerProducts.listForShop(shop.id)).filter(
        (product) => product.status === 'approved',
      );
      rows.push({ id: shop.id, name: shop.name, about: shop.about, products: live.length });
    }
    return { shops: rows };
  });

  app.get('/shops/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const shop = await repository.partnerShops.findById(id);
    if (!shop || !planPaid(shop)) throw new NotFoundError('shop');
    const live = (await repository.partnerProducts.listForShop(shop.id)).filter(
      (product) => product.status === 'approved',
    );
    return {
      shop: { id: shop.id, name: shop.name, about: shop.about, address: shop.address },
      products: live.map((product) => ({
        id: product.id,
        name: product.name,
        pricePence: product.pricePence,
        tags: product.tags,
        expiresOn: product.expiresOn,
        hasPhoto: product.photo !== null,
        catalogueItemId: product.catalogueItemId,
      })),
    };
  });

  app.get('/shops/:id/products/:productId/photo', async (request, reply) => {
    const { id, productId } = z
      .object({ id: z.string().min(1), productId: z.string().min(1) })
      .parse(request.params);
    const product = await repository.partnerProducts.findById(productId);
    if (
      !product ||
      product.partnerShopId !== id ||
      product.status !== 'approved' ||
      !product.photo ||
      !product.photoType
    ) {
      throw new NotFoundError('photo');
    }
    void reply.header('content-type', product.photoType);
    void reply.header('cache-control', 'public, max-age=3600');
    return reply.send(Buffer.from(product.photo));
  });

  /**
   * The one paid mention for a Shopper's search, if a Spotlight shop sells it and has not used
   * up this Shopper's weekly limit. Shown and said after the genuine results, as an advert.
   */
  app.get('/spotlight', async (request) => {
    const session = requireSession(request, 'shopper');
    const { q } = z.object({ q: z.string().trim().min(2).max(80) }).parse(request.query);
    // Ozi Plus and Family and Carer: no adverts, ever (ruling 58).
    const shopper = await repository.shoppers.findById(session.accountId);
    if (shopper && hasPlusExtras(shopper, now())) return { advert: null };
    return { advert: await chooseAdvert(app.ctx, session.accountId, q) };
  });

  /* ------------------------------------------------------------------ organisations */

  async function myOrganisation(request: Parameters<typeof businessActor>[0]) {
    const user = await businessActor(request, 'organisation');
    const organisation = user.organisationId
      ? await repository.organisations.findById(user.organisationId)
      : null;
    if (!organisation) throw new NotFoundError('organisation');
    return { user, organisation };
  }

  app.get('/organisation/dashboard', async (request) => {
    const { organisation } = await myOrganisation(request);
    const at = now();
    const monthStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
    const lastMonthStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 1, 1));
    const people = await repository.organisations.listServiceUsers(organisation.id);

    const orders: Array<{
      id: string;
      person: string;
      office: string;
      createdAt: Date;
      status: string;
      items: number;
      paidPence: number;
    }> = [];
    const upcoming: Array<{
      person: string;
      office: string;
      dayOfWeek: number;
      estimatePence: number;
    }> = [];
    for (const person of people) {
      for (const order of await repository.orders.listForShopper(person.id)) {
        if (!PAID_STATUSES.has(order.status)) continue;
        orders.push({
          id: order.id,
          person: person.displayName,
          office: person.organisationOffice ?? '',
          createdAt: order.createdAt,
          status: order.status,
          items: order.items.reduce((sum, item) => sum + item.quantity, 0),
          paidPence: paidAmount(order),
        });
      }
      for (const set of await repository.sets.listForShopper(person.id)) {
        if (!set.active) continue;
        upcoming.push({
          person: person.displayName,
          office: person.organisationOffice ?? '',
          dayOfWeek: set.dayOfWeek,
          // The people an organisation looks after have Membership delivery, and item charges
          // on every unit (ruling 58).
          estimatePence:
            set.items.reduce(
              (sum, item) =>
                sum + displayPricePence(item.estimatedPricePence, config.fees) * item.quantity,
              0,
            ) + config.fees.delivery.membershipPence,
        });
      }
    }
    orders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const thisMonth = orders.filter((order) => order.createdAt >= monthStart);
    const lastMonth = orders.filter(
      (order) => order.createdAt >= lastMonthStart && order.createdAt < monthStart,
    );
    const sum = (rows: typeof orders): number =>
      rows.reduce((total, row) => total + row.paidPence, 0);
    const spentThisMonth = sum(thisMonth);
    const byOffice = new Map<string, number>();
    for (const row of thisMonth) {
      const office = row.office || 'No office given';
      byOffice.set(office, (byOffice.get(office) ?? 0) + row.paidPence);
    }
    // Savings, from the organisation's own figure for what a staff trip to the shops costs them.
    const tripCost = organisation.staffTripCostPence;
    const savedThisMonth =
      tripCost === null
        ? null
        : thisMonth.length * Math.max(0, tripCost - config.fees.delivery.membershipPence);

    return {
      organisation: {
        id: organisation.id,
        name: organisation.name,
        joinCode: organisation.joinCode,
        monthlyBudgetPence: organisation.monthlyBudgetPence,
        staffTripCostPence: organisation.staffTripCostPence,
      },
      totals: {
        spentThisMonthPence: spentThisMonth,
        spentLastMonthPence: sum(lastMonth),
        spentAllTimePence: sum(orders),
        deliveriesThisMonth: thisMonth.length,
        budgetLeftPence:
          organisation.monthlyBudgetPence === null
            ? null
            : organisation.monthlyBudgetPence - spentThisMonth,
        savedThisMonthPence: savedThisMonth,
        upcomingWeeklyPence: upcoming.reduce((total, row) => total + row.estimatePence, 0),
      },
      byOffice: [...byOffice.entries()].map(([office, pence]) => ({ office, pence })),
      people: people.map((person) => ({
        id: person.id,
        name: person.displayName,
        office: person.organisationOffice ?? '',
      })),
      orders: orders.slice(0, 200),
      upcoming,
      deliveryFeePence: config.fees.delivery.membershipPence,
      // What the organisation pays a month for the people it looks after (ruling 58).
      plan: organisationPlan(people.length),
      sharePath: organisation.joinCode ? `/join/organisation/${organisation.joinCode}` : null,
      referrals:
        (organisation.joinCode
          ? await countJoinedVia(`organisation:${organisation.joinCode}`)
          : 0) + people.length,
    };
  });

  /** 51 becomes "51st", 2 "2nd", 13 "13th". */
  function ordinal(n: number): string {
    const tens = n % 100;
    const suffix =
      tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
    return `${n}${suffix}`;
  }

  /** £10 a client a month, every 51st client half price, from config/store.json. */
  function organisationPlan(clients: number) {
    const pricing = config.extras.organisations;
    const discounted = Math.floor(clients / pricing.discountEveryNthClient);
    const monthlyPence = organisationMonthlyPence(clients, pricing);
    return {
      clients,
      monthlyPence,
      clientMonthlyPence: pricing.clientMonthlyPence,
      discountEveryNthClient: pricing.discountEveryNthClient,
      discountedClientMonthlyPence: pricing.discountedClientMonthlyPence,
      discountedClients: discounted,
      words:
        `${clients} client${clients === 1 ? '' : 's'}: ${clients - discounted} at ${money(pricing.clientMonthlyPence)}` +
        (discounted > 0 ? ` and ${discounted} at ${money(pricing.discountedClientMonthlyPence)}` : '') +
        `, ${money(monthlyPence)} a month. Every ${ordinal(pricing.discountEveryNthClient)} client is ${money(pricing.discountedClientMonthlyPence)}. Each client's orders have the item charges and Membership delivery at ${money(config.fees.delivery.membershipPence)}.`,
    };
  }

  app.get('/organisation/statement.pdf', async (request, reply) => {
    const { organisation } = await myOrganisation(request);
    const people = await repository.organisations.listServiceUsers(organisation.id);
    const rows: Array<{ at: Date; line: string; pence: number }> = [];
    for (const person of people) {
      for (const order of await repository.orders.listForShopper(person.id)) {
        if (!PAID_STATUSES.has(order.status)) continue;
        const pence = paidAmount(order);
        rows.push({
          at: order.createdAt,
          pence,
          line: `${longDay(order.createdAt)}: for ${person.displayName}${person.organisationOffice ? ` (${person.organisationOffice})` : ''}, ${order.items.reduce((sum, item) => sum + item.quantity, 0)} items, ${money(pence)}. Reference ${order.id}.`,
        });
      }
    }
    rows.sort((a, b) => b.at.getTime() - a.at.getTime());
    const lines = [
      organisation.name,
      `Statement from ${config.productName}, ${longDay(now())}.`,
      '',
      ...(rows.length === 0 ? ['No orders yet.'] : rows.map((row) => row.line)),
      '',
      `Total: ${money(rows.reduce((sum, row) => sum + row.pence, 0))} over ${rows.length} order${rows.length === 1 ? '' : 's'}.`,
      '',
      `Monthly plan: ${organisationPlan(people.length).words}`,
    ];
    void reply.header('content-type', 'application/pdf');
    void reply.header(
      'content-disposition',
      `attachment; filename="${safeName(organisation.name)} statement.pdf"`,
    );
    return reply.send(textPdf(`${config.productName} statement`, lines));
  });

  app.post('/organisation/settings', async (request) => {
    const { organisation } = await myOrganisation(request);
    const body = z
      .object({
        monthlyBudgetPence: z.number().int().min(0).max(100_000_000).nullable().optional(),
        staffTripCostPence: z.number().int().min(0).max(100_000).nullable().optional(),
      })
      .parse(request.body ?? {});
    await repository.organisations.update(organisation.id, {
      ...(body.monthlyBudgetPence !== undefined
        ? { monthlyBudgetPence: body.monthlyBudgetPence }
        : {}),
      ...(body.staffTripCostPence !== undefined
        ? { staffTripCostPence: body.staffTripCostPence }
        : {}),
    });
    return { message: 'Saved.' };
  });

  async function myPerson(organisationId: string, shopperId: string) {
    const person = await repository.shoppers.findById(shopperId);
    if (!person || person.organisationId !== organisationId) throw new NotFoundError('person');
    return person;
  }

  app.post('/organisation/people/:id/office', async (request) => {
    const { organisation } = await myOrganisation(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const { office } = z.object({ office: z.string().trim().max(80) }).parse(request.body ?? {});
    const person = await myPerson(organisation.id, id);
    await repository.shoppers.update(person.id, { organisationOffice: office || null });
    return {
      message: `${person.displayName} is looked after by ${office || 'no office in particular'}.`,
    };
  });

  app.post('/organisation/people/:id/remove', async (request) => {
    const { organisation } = await myOrganisation(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const person = await myPerson(organisation.id, id);
    await repository.shoppers.update(person.id, { organisationId: null, organisationOffice: null });
    return { message: `${person.displayName} is no longer linked to ${organisation.name}.` };
  });

  /* ------------------------------------------------------------------ a Shopper joining one */

  /**
   * Only the person themselves links their account to an organisation, with the code the
   * organisation gives them, having been told what it will see (Section R: consent).
   */
  app.get('/me/organisation', async (request) => {
    const session = requireSession(request, 'shopper');
    const shopper = await repository.shoppers.findById(session.accountId);
    const organisation = shopper?.organisationId
      ? await repository.organisations.findById(shopper.organisationId)
      : null;
    return { organisation: organisation ? { name: organisation.name } : null };
  });

  app.post('/me/organisation', async (request) => {
    const session = requireSession(request, 'shopper');
    const { code } = z
      .object({
        code: z.string().trim().min(4, 'Please type the code the organisation gave you.').max(20),
        agreed: z.literal(true, {
          errorMap: () => ({
            message:
              'Please agree first that the organisation will see your orders and what they cost.',
          }),
        }),
      })
      .parse(request.body ?? {});
    const organisation = await repository.organisations.findByJoinCode(
      code.toUpperCase().replace(/[^A-Z0-9]/g, ''),
    );
    if (!organisation || !organisation.active)
      throw new NotFoundError('organisation with that code');
    await repository.shoppers.update(session.accountId, {
      organisationId: organisation.id,
      organisationOffice: null,
    });
    return {
      organisation: { name: organisation.name },
      message: `You're now linked to ${organisation.name}. They can see your orders and what they cost. You can stop this at any time in Settings.`,
    };
  });

  app.post('/me/organisation/leave', async (request) => {
    const session = requireSession(request, 'shopper');
    await repository.shoppers.update(session.accountId, {
      organisationId: null,
      organisationOffice: null,
    });
    return {
      organisation: null,
      message: 'Done. That organisation can no longer see your orders.',
    };
  });

  /* ------------------------------------------------------------------ admin: shops and organisations */

  app.get('/staff/partners', async (request) => {
    await staffActor(request, 'partners');
    const shops = [];
    for (const shop of await repository.partnerShops.list()) {
      const products = await repository.partnerProducts.listForShop(shop.id);
      const users = await repository.businessUsers.listFor({ partnerShopId: shop.id });
      shops.push({
        ...shop,
        paid: planPaid(shop),
        spotlightActive: spotlightActive(shop, now()),
        live: products.filter((product) => product.status === 'approved').length,
        waiting: products.filter((product) => product.status === 'pending').length,
        users: users.map((user) => ({ id: user.id, name: user.name, username: user.username })),
      });
    }
    const organisations = [];
    for (const organisation of await repository.organisations.list()) {
      const users = await repository.businessUsers.listFor({ organisationId: organisation.id });
      organisations.push({
        id: organisation.id,
        name: organisation.name,
        joinCode: organisation.joinCode,
        people: (await repository.organisations.listServiceUsers(organisation.id)).length,
        users: users.map((user) => ({
          id: user.id,
          name: user.name,
          username: user.username,
          office: user.office,
        })),
      });
    }
    return {
      shops,
      organisations,
      partnerMonthlyPence: config.extras.partnerMonthlyPence,
      spotlightPence: config.extras.spotlightPence,
      spotlightPlusPence: config.extras.spotlightPlusPence,
    };
  });

  app.post('/staff/partners', async (request, reply) => {
    const actor = await staffActor(request, 'partners');
    const body = z
      .object({
        name: z.string().trim().min(2, 'Please give the shop’s name.').max(120),
        address: z.string().trim().max(300).default(''),
        telephone: z.string().trim().max(30).default(''),
        about: z.string().trim().max(500).default(''),
        monthlyPence: z.number().int().min(0).max(1_000_000).optional(),
        paidMonths: z.number().int().min(0).max(24).default(1),
      })
      .parse(request.body ?? {});
    const shop = await repository.partnerShops.create({
      name: body.name,
      address: body.address,
      telephone: body.telephone,
      about: body.about,
      monthlyPence: body.monthlyPence ?? config.extras.partnerMonthlyPence,
    });
    const paid =
      body.paidMonths > 0
        ? await repository.partnerShops.update(shop.id, {
            paidUntil: addMonths(now(), body.paidMonths),
          })
        : shop;
    if (body.paidMonths > 0) {
      await repository.partnerPayments.create({
        partnerShopId: shop.id,
        kind: 'plan',
        amountPence: shop.monthlyPence * body.paidMonths,
        months: body.paidMonths,
        coversUntil: paid.paidUntil ?? now(),
        recordedBy: actor.name,
        paidAt: now(),
      });
    }
    void reply.status(201);
    return { shop: paid };
  });

  /** Records a payment: the plan, or Spotlight or Spotlight Plus on top of it. */
  app.post('/staff/partners/:id', async (request) => {
    const actor = await staffActor(request, 'partners');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        paidMonths: z.number().int().min(1).max(24).optional(),
        kind: z.enum(['plan', 'spotlight', 'plus']).default('plan'),
        active: z.boolean().optional(),
      })
      .parse(request.body ?? {});
    const shop = await repository.partnerShops.findById(id);
    if (!shop) throw new NotFoundError('partner shop');
    const at = now();
    let updated = shop;
    if (body.paidMonths) {
      if (body.kind === 'plan') {
        const from = shop.paidUntil && shop.paidUntil > at ? shop.paidUntil : at;
        updated = await repository.partnerShops.update(shop.id, {
          paidUntil: addMonths(from, body.paidMonths),
        });
        await repository.partnerPayments.create({
          partnerShopId: shop.id,
          kind: 'plan',
          amountPence: shop.monthlyPence * body.paidMonths,
          months: body.paidMonths,
          coversUntil: updated.paidUntil ?? at,
          recordedBy: actor.name,
          paidAt: now(),
        });
      } else {
        // Ozi mentions are only for Shop Partners whose plan is paid.
        if (!planPaid(shop)) {
          throw new ConflictError(
            'Spotlight is only for Shop Partners whose monthly plan is paid.',
          );
        }
        const sameLevel =
          shop.spotlight === body.kind && shop.spotlightUntil && shop.spotlightUntil > at;
        const from = sameLevel && shop.spotlightUntil ? shop.spotlightUntil : at;
        const price =
          body.kind === 'plus' ? config.extras.spotlightPlusPence : config.extras.spotlightPence;
        updated = await repository.partnerShops.update(shop.id, {
          spotlight: body.kind,
          spotlightUntil: addMonths(from, body.paidMonths),
        });
        await repository.partnerPayments.create({
          partnerShopId: shop.id,
          kind: body.kind,
          amountPence: price * body.paidMonths,
          months: body.paidMonths,
          coversUntil: updated.spotlightUntil ?? at,
          recordedBy: actor.name,
          paidAt: now(),
        });
      }
    }
    if (body.active !== undefined) {
      updated = await repository.partnerShops.update(shop.id, { active: body.active });
    }
    return { shop: updated };
  });

  app.post('/staff/partners/:id/users', async (request, reply) => {
    await staffActor(request, 'partners');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({ name: z.string().trim().min(2).max(80), username: usernameSchema })
      .parse(request.body ?? {});
    const shop = await repository.partnerShops.findById(id);
    if (!shop) throw new NotFoundError('partner shop');
    void reply.status(201);
    return newUser('partner', { partnerShopId: shop.id }, body);
  });

  app.get('/staff/partner-products', async (request) => {
    await staffActor(request, 'partners');
    const rows = [];
    for (const product of await repository.partnerProducts.listPending()) {
      const shop = await repository.partnerShops.findById(product.partnerShopId);
      rows.push({ ...publicProduct(product), shopName: shop?.name ?? '' });
    }
    return { products: rows };
  });

  app.get('/staff/partner-products/:id/photo', async (request, reply) => {
    await staffActor(request, 'partners');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const product = await repository.partnerProducts.findById(id);
    if (!product?.photo || !product.photoType) throw new NotFoundError('photo');
    void reply.header('content-type', product.photoType);
    void reply.header('cache-control', 'no-store');
    return reply.send(Buffer.from(product.photo));
  });

  app.post('/staff/partner-products/:id/decide', async (request) => {
    await staffActor(request, 'partners');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({ approve: z.boolean(), note: z.string().trim().max(300).optional() })
      .parse(request.body ?? {});
    const product = await repository.partnerProducts.findById(id);
    if (!product) throw new NotFoundError('product');
    if (product.status !== 'pending') throw new ConflictError('That one has already been decided.');
    if (!body.approve) {
      const updated = await repository.partnerProducts.update(product.id, {
        status: 'rejected',
        note: body.note ?? null,
        decidedAt: now(),
      });
      return { product: publicProduct(updated) };
    }
    if (NEVER_FOUND.test(`${product.name} ${product.tags}`)) {
      throw new BadRequestError('That is something we never bring, so it cannot be approved.');
    }
    const shop = await repository.partnerShops.findById(product.partnerShopId);
    if (!shop) throw new NotFoundError('partner shop');
    // In the catalogue, so it can go in a basket like anything else, with the shop's name on it.
    const item = await repository.catalogue.create({
      name: `${product.name} (${shop.name})`,
      category: `From ${shop.name}`,
      estimatedPricePence: product.pricePence,
      source: 'partner_feed',
      externalRef: `partner:${product.id}`,
    });
    const updated = await repository.partnerProducts.update(product.id, {
      status: 'approved',
      catalogueItemId: item.id,
      note: body.note ?? null,
      decidedAt: now(),
    });
    return { product: publicProduct(updated) };
  });

  app.post('/staff/organisations', async (request, reply) => {
    await staffActor(request, 'partners');
    const body = z
      .object({
        name: z.string().trim().min(2, 'Please give the organisation’s name.').max(120),
        contactName: z.string().trim().min(2).max(80),
        contactEmail: z.string().trim().max(120).default(''),
        contactPhone: z.string().trim().max(30).optional(),
      })
      .parse(request.body ?? {});
    const organisation = await repository.organisations.create(body);
    let joinCode = '';
    do {
      joinCode = Array.from(
        { length: 6 },
        () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
      ).join('');
    } while (await repository.organisations.findByJoinCode(joinCode));
    const updated = await repository.organisations.update(organisation.id, { joinCode });
    void reply.status(201);
    return { organisation: updated };
  });

  app.post('/staff/organisations/:id/users', async (request, reply) => {
    await staffActor(request, 'partners');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        name: z.string().trim().min(2).max(80),
        username: usernameSchema,
        office: z.string().trim().max(80).default(''),
      })
      .parse(request.body ?? {});
    const organisation = await repository.organisations.findById(id);
    if (!organisation) throw new NotFoundError('organisation');
    void reply.status(201);
    return newUser('organisation', { organisationId: organisation.id }, body);
  });
}

function addMonths(from: Date, months: number): Date {
  const next = new Date(from);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}
