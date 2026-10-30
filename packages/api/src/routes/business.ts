/**
 * Partner shops and organisations (7 October 2026, ruling 41; ruling 65, 16 and 17 October 2026).
 *
 * A shop, café, takeaway or service joins by itself from the "Shop Partner" door, confirming its
 * mobile with a code, and gets its sign-in at once; its page goes public once a person approves
 * it. A basic listing is free for ever for the first shops to join; Partner Plus is paid from the
 * dashboard through Stripe Checkout; a café or takeaway pays a commission on orders placed
 * through the app instead; a service lists services and takes enquiries, with no money through
 * us. Ozi lists well-known shops itself, which their owners can claim. Each new product is
 * approved by a person before Shoppers see it. An organisation signs in to see what the people
 * it supports have ordered, who in the organisation looks after them, what it has spent and
 * saved, and what is coming. Each kind of account has its own sign-in and sees only its own things.
 */

import { randomInt } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import {
  basisPointsWords,
  BROWSE_SECTIONS,
  chosenFrom,
  commissionPence,
  matchesBrowseSearch,
  postcodeNearness,
  sectionOf,
  allowancePlanWords,
  deliveryFeePence,
  deliveryStepsWords,
  displayPricePence,
  excludedServiceKind,
  excludedServiceWords,
  formatPence,
  freeListingAvailable,
  organisationMonthlyPence,
  ORGANISATION_CONSENT_VERSION,
  PARTNER_KIND_WORDS,
  PARTNER_KINDS,
  postcodeArea,
  productLimit,
  SHOP_PARTNER_TERMS_VERSION,
  tidyPostcode,
  type PartnerKind,
} from '@aldilivery/core';
import { z } from 'zod';

import { phoneConfirmedAtSignUp, requireSession } from '../app.js';
import { READABLE_IMAGES } from '../lib/language-model.js';
import { hasPlusExtras } from '../services/plans.js';
import { locateLater } from '../services/areas.js';
import { estimatedPricePence } from '../services/suggest.js';
import type {
  AnalyticsEvent,
  BusinessKind,
  BusinessUser,
  Order,
  PartnerPayment,
  PartnerProduct,
  PartnerShop,
  ServiceEnquiry,
  Shopper,
} from '../domain.js';
import { BadRequestError, ConflictError, NotFoundError, UnauthorisedError } from '../errors.js';
import {
  businessActor,
  BUSINESS_SESSION_HOURS,
  signBusinessToken,
  signPartnerCheckout,
  verifyPartnerCheckout,
} from '../lib/business.js';
import { textPdf } from '../lib/pdf.js';
import { isUkMobile, ukPhone } from '../lib/phone.js';
import { NEVER_FOUND } from '../lib/restricted.js';
import { loadShopsSeed, seedShops } from '../lib/shops-seed.js';
import { chooseAdvert, spotlightActive } from '../lib/spotlight.js';
import { awardTitlesByShop } from '../services/shop-of-the-month.js';
import { checkInBackground, checkPartnerProduct } from '../services/auto-check.js';
import { askOwner, settleMattersFor } from '../services/owner-desk.js';
import { decidePartnerProduct } from '../services/partner-products.js';
import { hashPassword, passwordMatches, staffActor, temporaryPassword } from '../lib/staff.js';
import { verifyPhoneProof } from '../lib/tokens.js';

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
  plan: 'Partner Plus',
  spotlight: 'Spotlight',
  plus: 'Spotlight Plus',
};

const ENQUIRY_WORDS: Record<ServiceEnquiry['kind'], string> = {
  quote: 'a quote',
  call_back: 'a call back',
};

/** A Checkout page for a partner's plan lasts this long. */
const CHECKOUT_HOURS = 23;

/**
 * Labels one shop may have read in a day while scanning (ruling 75): a frame is sent only when
 * the camera is steady on something new, so a whole shop's shelves fit well inside it.
 */
export const LABEL_READS_PER_DAY = 400;

/** A product's name as two listings are compared: "Apples, 6 pack" and "apples 6-pack" match. */
export function sameNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** A file name with nothing a browser or a computer would object to. */
function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9 .-]/g, '').trim() || 'statement';
}

function paidAmount(order: Order): number {
  return (order.finalTotalPence ?? order.totalEstimatePence) - order.creditAppliedPence;
}

/**
 * What a place is browsed under (ruling 82), as a form sends it: chosen from the lists in
 * `browse` in config/store.json, checked against them by `browseFieldsFor`.
 */
const browseFieldsSchema = z.object({
  cuisines: z.array(z.string().trim().max(60)).max(40).optional(),
  specialities: z.array(z.string().trim().max(60)).max(40).optional(),
  categories: z.array(z.string().trim().max(60)).max(40).optional(),
  convenience: z.boolean().optional(),
  ofstedNumber: z.string().trim().max(20).optional(),
});
type BrowseFieldsInput = z.infer<typeof browseFieldsSchema>;

/** An Ofsted unique reference number as providers write it: "EY123456" or "2345678". */
const OFSTED_NUMBER = /^[A-Z]{0,2}\d{6,8}$/;

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

  /**
   * Who the statement is from, as the law asks a business letter to say (Companies Act 2006 and
   * the trading disclosure regulations of 2015): every detail from `store` in config/store.json
   * (Anthony, 30 October 2026).
   */
  function companyLines(): string[] {
    const { store } = config;
    return [
      `${config.productName} is run by ${store.legalEntityName}, a company registered in ${store.registeredIn}, company number ${store.companyNumber}.`,
      `Registered office: ${store.registeredOffice}.`,
    ];
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

  /**
   * Whether an order's analysis row is this shop's: by the shop's id, which rows carry from 30
   * October 2026, or by its name for older rows, which have only that. A shop renamed, or two
   * shops of the same name, can no longer take each other's orders.
   */
  function eventForShop(event: AnalyticsEvent, shop: PartnerShop): boolean {
    return event.partnerShopId ? event.partnerShopId === shop.id : event.shop === shop.name;
  }

  /** How the shop is doing: purchases from it this week and this month (business analysis). */
  async function shopNumbers(shop: PartnerShop) {
    const at = now();
    const events = (
      await repository.analytics.list({
        since: new Date(at.getTime() - 30 * 24 * 60 * 60 * 1000),
        kind: 'order_paid',
      })
    ).filter((event) => eventForShop(event, shop));
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

  const partners = config.extras.partners;

  /** Approved by a person and not paused: its page is public (ruling 65). */
  function listed(shop: PartnerShop): boolean {
    return shop.active && shop.status === 'approved';
  }

  /**
   * Whether the shop's own products show: a free listing, a café, a takeaway or a service
   * always; a shop on Partner Plus only while it is paid.
   */
  function catalogueShown(shop: PartnerShop): boolean {
    if (!listed(shop)) return false;
    if (shop.kind !== 'shop' || shop.plan === 'free') return true;
    return planPaid(shop);
  }

  /**
   * A shop on Partner Plus whose month is paid: listed first among shops at the same distance
   * (ruling 75; worded so since 30 October 2026).
   */
  function onPaidPlus(shop: PartnerShop): boolean {
    return shop.kind === 'shop' && shop.plan === 'plus' && planPaid(shop);
  }

  /** Paid Partner Plus shops first, everyone else after, each group in its own order. */
  function plusFirst(shops: PartnerShop[]): PartnerShop[] {
    return [...shops.filter(onPaidPlus), ...shops.filter((shop) => !onPaidPlus(shop))];
  }

  /**
   * The seed shops that are branches of national chains (`chain: true` in shops-seed.json):
   * never claimable, since a branch manager cannot sign up for the whole company (30 October
   * 2026). Read once; a seed file that cannot be read leaves every Ozi listing claimable.
   */
  const chainSeedKeys = (() => {
    try {
      return new Set(
        loadShopsSeed(env.storeConfigPath)
          .filter((seed) => seed.chain)
          .map((seed) => seed.key),
      );
    } catch {
      return new Set<string>();
    }
  })();

  /**
   * Listed by Ozi, not a national chain's branch, and nobody has claimed it: its page invites
   * the owner to.
   */
  async function claimable(shop: PartnerShop): Promise<boolean> {
    if (shop.source !== 'ozi') return false;
    if (shop.seedKey && chainSeedKeys.has(shop.seedKey)) return false;
    return (await repository.businessUsers.listFor({ partnerShopId: shop.id })).length === 0;
  }

  /** How many free-for-ever listings have been given out so far. */
  async function freeListedCount(): Promise<number> {
    return (await repository.partnerShops.list()).filter(
      (shop) => shop.freeForever && shop.status !== 'removed',
    ).length;
  }

  /** The products (or services) a shop may have listed, live or waiting, or null for no limit. */
  function limitFor(shop: PartnerShop): number | null {
    return productLimit({ kind: shop.kind, plan: shop.plan, plusPaid: planPaid(shop) }, partners);
  }

  /** What a café or takeaway owes on this month's orders placed through the app (ruling 65). */
  async function commissionFor(shop: PartnerShop) {
    if (shop.kind !== 'food') return null;
    const events = (
      await repository.analytics.list({ since: monthStart(), kind: 'order_paid' })
    ).filter((event) => eventForShop(event, shop));
    const goodsPence = events.reduce((sum, event) => sum + event.goodsPence, 0);
    return {
      basisPoints: partners.foodCommissionBasisPoints,
      words: basisPointsWords(partners.foodCommissionBasisPoints),
      ordersThisMonth: events.length,
      goodsThisMonthPence: goodsPence,
      owedThisMonthPence: commissionPence(goodsPence, partners.foodCommissionBasisPoints),
    };
  }

  function publicEnquiry(
    row: ServiceEnquiry,
    extra: { shopName?: string; shopperName?: string; contact?: string },
  ) {
    return {
      id: row.id,
      kind: row.kind,
      what: ENQUIRY_WORDS[row.kind],
      message: row.message,
      status: row.status,
      reply: row.reply,
      createdAt: row.createdAt,
      answeredAt: row.answeredAt,
      ...extra,
    };
  }

  /** The row every public list and page shows for a shop (ruling 65; what it is browsed under, ruling 82). */
  function publicShopRow(shop: PartnerShop) {
    return {
      id: shop.id,
      name: shop.name,
      about: shop.about,
      kind: shop.kind,
      kindWords: PARTNER_KIND_WORDS[shop.kind],
      area: postcodeArea(shop.postcode),
      hours: shop.hours,
      listedByOzi: shop.source === 'ozi',
      section: sectionOf(shop),
      cuisines: shop.kind === 'food' ? shop.cuisines : [],
      specialities: shop.kind === 'shop' ? shop.specialities : [],
      categories: shop.kind === 'service' ? shop.categories : [],
      convenience: shop.kind === 'shop' && shop.convenience,
      // As the provider gave it; the page says plainly that nobody here checks it.
      ofstedNumber: shop.kind === 'service' ? shop.ofstedNumber : '',
    };
  }

  /** The words a search looks through besides the name and the words about the place. */
  function browseTags(shop: PartnerShop): string[] {
    return [...shop.cuisines, ...shop.specialities, ...shop.categories];
  }

  /**
   * What a place is browsed under (ruling 82), checked against the lists in config: only the
   * fields its kind has (a cuisine for food, a speciality and the convenience flag for a shop, a
   * category and an Ofsted number for a service), anything off the list refused in plain words,
   * and a childminder's Ofsted registration number required, as the provider gives it.
   */
  function browseFieldsFor(
    kind: PartnerKind,
    input: BrowseFieldsInput,
    existing?: PartnerShop,
  ): Pick<
    PartnerShop,
    'cuisines' | 'specialities' | 'categories' | 'convenience' | 'ofstedNumber'
  > {
    const browse = config.browse;
    const pick = (values: string[] | undefined, list: readonly string[], words: string) => {
      const { chosen, unknown } = chosenFrom(values ?? [], list);
      if (unknown.length > 0) {
        throw new BadRequestError(
          `${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not on our list of ${words}. Please choose from the list.`,
        );
      }
      return chosen;
    };
    const cuisines =
      kind !== 'food'
        ? []
        : input.cuisines !== undefined
          ? pick(input.cuisines, browse.cuisines, 'cuisines')
          : (existing?.cuisines ?? []);
    const specialities =
      kind !== 'shop'
        ? []
        : input.specialities !== undefined
          ? pick(input.specialities, browse.shopOrigins, 'shop specialities')
          : (existing?.specialities ?? []);
    const categories =
      kind !== 'service'
        ? []
        : input.categories !== undefined
          ? pick(input.categories, browse.serviceCategories, 'kinds of service')
          : (existing?.categories ?? []);
    const convenience = kind === 'shop' && (input.convenience ?? existing?.convenience ?? false);
    const ofstedNumber =
      kind !== 'service'
        ? ''
        : (input.ofstedNumber ?? existing?.ofstedNumber ?? '').toUpperCase().replace(/\s+/g, '');
    if (ofstedNumber !== '' && !OFSTED_NUMBER.test(ofstedNumber)) {
      throw new BadRequestError(
        'That does not look like an Ofsted registration number. It is 6 to 8 digits, sometimes with letters such as EY in front.',
      );
    }
    const needsOfsted = categories.some((category) => browse.ofstedCategories.includes(category));
    if (needsOfsted && ofstedNumber === '') {
      throw new BadRequestError(
        `A childminder must be registered with Ofsted. Please give your Ofsted registration number. ${config.productName} shows it as you give it.`,
      );
    }
    return { cuisines, specialities, categories, convenience, ofstedNumber };
  }

  /** What a joining shop is told about the tiers, from config/store.json. */
  async function joinOptions() {
    const freeLeft = Math.max(0, partners.freeListingCount - (await freeListedCount()));
    return {
      kinds: PARTNER_KINDS.map((kind) => ({ kind, words: PARTNER_KIND_WORDS[kind] })),
      freeListingsLeft: freeLeft,
      freeProductLimit: partners.freeProductLimit,
      plusMonthlyPence: partners.plusMonthlyPence,
      plusFirstMonthFree: partners.plusFirstMonthFree,
      foodCommissionWords: basisPointsWords(partners.foodCommissionBasisPoints),
      spotlightPence: config.extras.spotlightPence,
      spotlightPlusPence: config.extras.spotlightPlusPence,
      excludedServiceKinds: partners.excludedServiceKinds,
      mobileConfirmed: phoneConfirmedAtSignUp(app.ctx),
    };
  }

  /** The plan in one plain sentence, for the screen and for Ozi. */
  function planWords(shop: PartnerShop, limit: number | null): string {
    if (shop.kind === 'food') {
      return `No monthly fee. ${basisPointsWords(partners.foodCommissionBasisPoints)} of each order placed through ${config.productName} is owed as commission, shown here and on your statement.`;
    }
    if (shop.kind === 'service') {
      return `Free listing. Shoppers ask you for a quote or a call back here; no payment goes through ${config.productName} for services yet.`;
    }
    if (shop.plan === 'plus') {
      return planPaid(shop) && shop.paidUntil
        ? `Partner Plus, ${money(partners.plusMonthlyPence)} a month, paid until ${longDay(shop.paidUntil)}: the full catalogue with photos, Shop of the Month, and first place among shops at the same distance.`
        : `Partner Plus, ${money(partners.plusMonthlyPence)} a month, is not paid at the moment, so your products are hidden. Pay here, or ring us.`;
    }
    return `Free listing: your name, address, hours and up to ${limit ?? partners.freeProductLimit} products. Partner Plus, ${money(partners.plusMonthlyPence)} a month, adds the full catalogue with photos, Shop of the Month, and first place among shops at the same distance${partners.plusFirstMonthFree && !shop.plusTrialUsed ? ', with the first month free' : ''}.`;
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
      durationMinutes: product.durationMinutes,
      barcode: product.barcode,
      priceEstimated: product.priceEstimated,
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
    const limit = limitFor(shop);
    const listedCount = products.filter((product) => product.status !== 'rejected').length;
    return {
      shop: {
        id: shop.id,
        name: shop.name,
        address: shop.address,
        telephone: shop.telephone,
        about: shop.about,
        kind: shop.kind,
        kindWords: PARTNER_KIND_WORDS[shop.kind],
        postcode: shop.postcode,
        hours: shop.hours,
        status: shop.status,
        active: shop.active,
        listed: listed(shop),
        section: sectionOf(shop),
        cuisines: shop.cuisines,
        specialities: shop.specialities,
        categories: shop.categories,
        convenience: shop.convenience,
        ofstedNumber: shop.ofstedNumber,
      },
      plan: {
        tier: shop.plan,
        monthlyPence: shop.monthlyPence,
        plusMonthlyPence: partners.plusMonthlyPence,
        paidUntil: shop.paidUntil,
        paid: planPaid(shop),
        freeForever: shop.freeForever,
        firstMonthFree: partners.plusFirstMonthFree && !shop.plusTrialUsed,
        productLimit: limit,
        productsListed: listedCount,
        canAddProduct: limit === null || listedCount < limit,
        words: planWords(shop, limit),
      },
      commission: await commissionFor(shop),
      enquiries:
        shop.kind === 'service'
          ? await Promise.all(
              (await repository.serviceEnquiries.listForShop(shop.id)).map(async (row) =>
                publicEnquiry(row, {
                  shopperName:
                    (await repository.shoppers.findById(row.shopperId))?.displayName ?? 'A Shopper',
                  contact: row.contact,
                }),
              ),
            )
          : [],
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
      numbers: await shopNumbers(shop),
    };
  });

  /**
   * How Shoppers find the place (ruling 82): its cuisines, specialities or categories from the
   * lists in config, the convenience flag for a shop, a childminder's Ofsted number, and its
   * words about itself. The excluded kinds are refused here as on the join form.
   */
  app.post('/partner/profile', async (request) => {
    const shop = await myShop(request);
    const body = browseFieldsSchema
      .extend({ about: z.string().trim().max(500).optional() })
      .parse(request.body ?? {});
    if (body.about !== undefined) {
      const refused = excludedServiceKind(
        `${shop.name} ${body.about}`,
        partners.excludedServiceKinds,
      );
      if (refused) throw new BadRequestError(excludedServiceWords(refused, config.productName));
    }
    const updated = await repository.partnerShops.update(shop.id, {
      ...browseFieldsFor(shop.kind, body, shop),
      ...(body.about !== undefined ? { about: body.about } : {}),
    });
    return {
      shop: {
        section: sectionOf(updated),
        cuisines: updated.cuisines,
        specialities: updated.specialities,
        categories: updated.categories,
        convenience: updated.convenience,
        ofstedNumber: updated.ofstedNumber,
        about: updated.about,
      },
      message: 'Saved. Shoppers find you under what you chose.',
    };
  });

  app.get('/partner/statement.pdf', async (request, reply) => {
    const shop = await myShop(request);
    const payments = await repository.partnerPayments.listForShop(shop.id);
    const total = payments.reduce((sum, row) => sum + row.amountPence, 0);
    const commission = await commissionFor(shop);
    const lines = [
      `${shop.name}`,
      `Statement from ${config.productName}, ${longDay(now())}.`,
      ...companyLines(),
      '',
      ...(payments.length === 0
        ? ['No payments recorded yet.']
        : payments.map(
            (row) =>
              `${longDay(row.paidAt)}: ${PAYMENT_WORDS[row.kind]}, ${row.months} month${row.months === 1 ? '' : 's'}, ${money(row.amountPence)}. Covers until ${longDay(row.coversUntil)}.`,
          )),
      '',
      `Total paid: ${money(total)}.`,
      `Plan: ${planWords(shop, limitFor(shop))}`,
      ...(commission
        ? [
            '',
            `Commission this month: ${commission.ordersThisMonth} order${commission.ordersThisMonth === 1 ? '' : 's'} through ${config.productName}, ${money(commission.goodsThisMonthPence)} of goods, ${commission.words} owed: ${money(commission.owedThisMonthPence)}.`,
          ]
        : []),
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
    if (shop.status === 'removed' || !shop.active) {
      throw new ConflictError('This listing is paused, so nothing can be added. Please ring us.');
    }
    // A shop on Partner Plus that has lapsed keeps a free listing's allowance (ruling 65).
    if (shop.kind === 'shop' && shop.plan === 'plus' && !planPaid(shop) && !shop.freeForever) {
      throw new ConflictError(
        `Partner Plus is not paid at the moment, so new products cannot be added. Pay from your dashboard, ${money(partners.plusMonthlyPence)} a month, or ring us.`,
      );
    }
    const limit = limitFor(shop);
    if (limit !== null) {
      const listedCount = (await repository.partnerProducts.listForShop(shop.id)).filter(
        (product) => product.status === 'approved' || product.status === 'pending',
      ).length;
      if (listedCount >= limit) {
        throw new ConflictError(
          `A free listing carries up to ${limit} products. For the full catalogue with photos, join Partner Plus from your dashboard, ${money(partners.plusMonthlyPence)} a month${partners.plusFirstMonthFree && !shop.plusTrialUsed ? ', the first month free' : ''}.`,
        );
      }
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
        /** A service: how long it takes. */
        durationMinutes: z
          .number()
          .int()
          .min(5)
          .max(24 * 60)
          .optional(),
        /** Scanned (ruling 75): the barcode digits, one listing for every identical pack. */
        barcode: z
          .string()
          .trim()
          .regex(/^\d{8,14}$/, 'A barcode is 8 to 14 digits.')
          .optional(),
        /** The label showed no price, so this one is an estimate to be checked. */
        priceEstimated: z.boolean().default(false),
      })
      .parse(request.body ?? {});
    // One product is one listing with one price, never one per pack (ruling 75).
    const already = (await repository.partnerProducts.listForShop(shop.id)).find(
      (product) =>
        (product.status === 'approved' || product.status === 'pending') &&
        ((body.barcode !== undefined && product.barcode === body.barcode) ||
          (sameNameKey(product.name) === sameNameKey(body.name) &&
            product.pricePence === body.pricePence)),
    );
    if (already) {
      throw new ConflictError(`${already.name} is already added.`);
    }
    if (NEVER_FOUND.test(`${body.name} ${body.tags}`)) {
      throw new BadRequestError(
        `${config.productName} never brings alcohol, tobacco, medicines, cash or anything age restricted, so that cannot be listed.`,
      );
    }
    if (shop.kind === 'service') {
      const refused = excludedServiceKind(
        `${body.name} ${body.tags}`,
        partners.excludedServiceKinds,
      );
      if (refused) throw new BadRequestError(excludedServiceWords(refused, config.productName));
      if (!body.durationMinutes) {
        throw new BadRequestError('Please say how long the service takes, in minutes.');
      }
    }
    if (body.photo && limit !== null) {
      throw new BadRequestError(
        `Photos come with Partner Plus, ${money(partners.plusMonthlyPence)} a month. On a free listing, add the product without a photo.`,
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
      durationMinutes: shop.kind === 'service' ? (body.durationMinutes ?? null) : null,
      barcode: shop.kind === 'service' ? null : (body.barcode ?? null),
      priceEstimated: body.priceEstimated,
    });
    // The automatic check (ruling 74): clear ones are approved at once, clearly restricted ones
    // refused by the rule lists, and anything doubtful goes to the owner.
    await checkInBackground(app.ctx, request.log, () =>
      checkPartnerProduct(app.ctx, product.id, request.log),
    );
    const latest = (await repository.partnerProducts.findById(product.id)) ?? product;
    const price =
      shop.kind === 'service' ? `from ${money(body.pricePence)}` : money(body.pricePence);
    const estimated = body.priceEstimated ? ' Its price is an estimate: please check it.' : '';
    const later =
      shop.status === 'pending' ? ' Your page goes public once we have checked your listing.' : '';
    void reply.status(201);
    return {
      product: publicProduct(latest),
      message:
        latest.status === 'approved'
          ? `Thank you. ${body.name}, ${price}, is checked and listed.${estimated}${later}`
          : latest.status === 'rejected'
            ? `${body.name} cannot be listed: ${latest.note ?? 'it is something we never bring.'}`
            : `Thank you. ${body.name}, ${price}, is waiting to be checked. It usually goes live within one working day.${estimated}${later}`,
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
    const updated = await repository.partnerProducts.update(product.id, {
      pricePence,
      priceEstimated: false,
    });
    if (product.catalogueItemId) {
      await repository.catalogue.update(product.catalogueItemId, {
        estimatedPricePence: pricePence,
        lastSeenAt: now(),
      });
    }
    // A change is checked like a new one (ruling 74): a doubtful price goes to the owner.
    await checkInBackground(app.ctx, request.log, () =>
      checkPartnerProduct(app.ctx, product.id, request.log, { edited: true }),
    );
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

  /* ------------------------------------------------------------------ scanning products (ruling 75) */

  /** Labels read today, by shop, so one shop's camera cannot run up the model's bill. */
  const labelReads = new Map<string, { day: string; count: number }>();

  /** Who may scan: any shop, café or takeaway whose listing can take products. */
  async function scanningShop(request: Parameters<typeof businessActor>[0]) {
    const shop = await myShop(request);
    if (shop.status === 'removed' || !shop.active) {
      throw new ConflictError('This listing is paused, so nothing can be added. Please ring us.');
    }
    if (shop.kind === 'service') {
      throw new BadRequestError('Scanning is for products. A service adds its services by typing.');
    }
    return shop;
  }

  /** The draft a scan gives back: the shop corrects it, then sends it with "Add all". */
  async function scanDraft(found: {
    name: string | null;
    size: string | null;
    pricePence: number | null;
    barcode: string | null;
  }) {
    const name = [found.name, found.size].filter(Boolean).join(', ').slice(0, 120);
    let pricePence = found.pricePence;
    let priceEstimated = false;
    if (pricePence === null && name) {
      pricePence = await estimatedPricePence(app.ctx, name);
      priceEstimated = pricePence !== null;
    }
    return { name, pricePence, priceEstimated, barcode: found.barcode };
  }

  /**
   * A photo of a shelf price label or a pack, from the camera held steady or a photo taken or
   * uploaded: the language model reads the name, the size, the price and the barcode. Nothing
   * is added here; the draft goes back to the shop's list for their "Add all".
   */
  app.post('/partner/scan/label', { bodyLimit: 7 * 1024 * 1024 }, async (request) => {
    const shop = await scanningShop(request);
    const body = z
      .object({
        photo: z
          .string()
          .min(1)
          .max(6 * 1024 * 1024),
        photoType: z.enum(READABLE_IMAGES),
      })
      .parse(request.body ?? {});
    const brain = app.ctx.brain;
    if (!brain?.readLabel) {
      return {
        draft: null,
        message: 'Reading labels is not working at the moment. Please type the product in.',
      };
    }
    const day = now().toISOString().slice(0, 10);
    const used = labelReads.get(shop.id);
    const count = used && used.day === day ? used.count : 0;
    if (count >= LABEL_READS_PER_DAY) {
      return {
        draft: null,
        message: `That is ${LABEL_READS_PER_DAY} labels read today, the most for one day. Scan barcodes or type the rest in, or carry on tomorrow.`,
      };
    }
    labelReads.set(shop.id, { day, count: count + 1 });
    const reading = await brain.readLabel({ data: body.photo, mediaType: body.photoType });
    if (!reading || (!reading.name && !reading.barcode)) {
      return {
        draft: null,
        message: 'I could not read that label. Hold it steady, a little closer.',
      };
    }
    let found = reading;
    if (!reading.name && reading.barcode) {
      const product = await app.ctx.openPrices?.lookUpBarcode?.(reading.barcode);
      found = { ...reading, name: product?.name ?? null };
    }
    const draft = await scanDraft(found);
    return { draft, message: '' };
  });

  /**
   * A barcode the camera saw: its name and size from the open food database, and a price from
   * the catalogue or the open price database, marked as an estimate (someone else's shelf). A
   * barcode nobody knows comes back with no name, for the shop to say or type it.
   */
  app.post('/partner/scan/barcode', async (request) => {
    await scanningShop(request);
    const { barcode } = z
      .object({
        barcode: z
          .string()
          .trim()
          .regex(/^\d{8,14}$/, 'A barcode is 8 to 14 digits.'),
      })
      .parse(request.body ?? {});
    const product = await app.ctx.openPrices?.lookUpBarcode?.(barcode);
    if (!product) {
      return { draft: { name: '', pricePence: null, priceEstimated: false, barcode } };
    }
    const draft = await scanDraft({
      name: product.name,
      size: null,
      pricePence: null,
      barcode,
    });
    if (product.pricePence !== null && (draft.pricePence === null || draft.priceEstimated)) {
      return { draft: { ...draft, pricePence: product.pricePence, priceEstimated: true } };
    }
    return { draft };
  });

  /* ------------------------------------------------------------------ the public shop pages */

  /**
   * Every approved shop, café, takeaway and service, with its kind and area (ruling 65). Since
   * ruling 82 it can be narrowed to one section (restaurants, shops, convenience, services), a
   * cuisine, a speciality or a category, and searched; given the Shopper's postcode (or, signed
   * in, their delivery address), places in the same district come first, marked near, then the
   * same area letters, then the rest.
   */
  app.get('/shops', async (request) => {
    const query = z
      .object({
        section: z.enum(BROWSE_SECTIONS).optional(),
        cuisine: z.string().trim().max(60).optional(),
        speciality: z.string().trim().max(60).optional(),
        category: z.string().trim().max(60).optional(),
        q: z.string().trim().max(100).optional(),
        near: z.string().trim().max(10).optional(),
      })
      .parse(request.query ?? {});
    const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
    const has = (list: string[], wanted: string | undefined): boolean =>
      !wanted || list.some((entry) => same(entry, wanted));
    let near = query.near ?? '';
    if (near === '' && request.session?.role === 'shopper') {
      const shopper = await repository.shoppers.findById(request.session.accountId);
      near =
        /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i.exec(shopper?.deliveryAddress ?? '')?.[0] ??
        '';
    }
    // Shops on paid Partner Plus come first, here, on the home page's "Stock up at local shops"
    // and in search (ruling 75); everyone else keeps the order they joined in. With a postcode,
    // nearness comes first and Partner Plus first within each distance (ruling 82).
    const plusOrdered = plusFirst(
      (await repository.partnerShops.list())
        .filter(listed)
        .filter((shop) => !query.section || sectionOf(shop) === query.section)
        .filter((shop) => has(shop.kind === 'food' ? shop.cuisines : [], query.cuisine))
        .filter((shop) => has(shop.kind === 'shop' ? shop.specialities : [], query.speciality))
        .filter((shop) => has(shop.kind === 'service' ? shop.categories : [], query.category))
        .filter((shop) =>
          matchesBrowseSearch(
            { name: shop.name, about: shop.about, tags: browseTags(shop) },
            query.q ?? '',
          ),
        ),
    );
    const nearness = new Map(
      plusOrdered.map((shop) => [shop.id, near ? postcodeNearness(near, shop.postcode) : 2]),
    );
    const shops = near
      ? [...plusOrdered].sort((a, b) => (nearness.get(a.id) ?? 2) - (nearness.get(b.id) ?? 2))
      : plusOrdered;
    // Shop of the Month, of the Quarter and of the Half Year (ruling 70): a badge with words.
    const awards = await awardTitlesByShop(app.ctx);
    const rows = [];
    for (const shop of shops) {
      const live = catalogueShown(shop)
        ? (await repository.partnerProducts.listForShop(shop.id)).filter(
            (product) => product.status === 'approved',
          )
        : [];
      rows.push({
        ...publicShopRow(shop),
        products: live.length,
        awards: awards.get(shop.id) ?? [],
        partnerPlus: onPaidPlus(shop),
        // Ruling 82: "Near you" (the same postcode district) or "Further away"; null with no postcode.
        nearYou: near ? nearness.get(shop.id) === 0 : null,
      });
    }
    return { shops: rows, near: near ? postcodeArea(near) : null };
  });

  app.get('/shops/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const shop = await repository.partnerShops.findById(id);
    if (!shop || !listed(shop)) throw new NotFoundError('shop');
    const live = catalogueShown(shop)
      ? (await repository.partnerProducts.listForShop(shop.id)).filter(
          (product) => product.status === 'approved',
        )
      : [];
    return {
      shop: {
        ...publicShopRow(shop),
        address: shop.address,
        claimable: await claimable(shop),
        awards: (await awardTitlesByShop(app.ctx)).get(shop.id) ?? [],
      },
      products: live.map((product) => ({
        id: product.id,
        name: product.name,
        pricePence: product.pricePence,
        tags: product.tags,
        expiresOn: product.expiresOn,
        hasPhoto: product.photo !== null,
        catalogueItemId: product.catalogueItemId,
        durationMinutes: product.durationMinutes,
      })),
    };
  });

  /**
   * A Shopper asks a service for a quote or a call back (ruling 65). No payment goes through us:
   * the service sees it on its dashboard, the Shopper under their order history.
   */
  app.post('/shops/:id/enquiry', async (request, reply) => {
    const session = requireSession(request, 'shopper');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        kind: z.enum(['quote', 'call_back']),
        productId: z.string().min(1).optional(),
        message: z.string().trim().max(600).default(''),
        contact: z
          .string()
          .trim()
          .min(3, 'Please say how they can reach you: a phone number or an email.')
          .max(120),
      })
      .parse(request.body ?? {});
    const shop = await repository.partnerShops.findById(id);
    if (!shop || !listed(shop)) throw new NotFoundError('shop');
    if (shop.kind !== 'service') {
      throw new BadRequestError('Quotes and call backs are for services. From a shop, you order.');
    }
    const product = body.productId
      ? await repository.partnerProducts.findById(body.productId)
      : null;
    if (body.productId && (!product || product.partnerShopId !== shop.id)) {
      throw new NotFoundError('service');
    }
    const row = await repository.serviceEnquiries.create({
      partnerShopId: shop.id,
      shopperId: session.accountId,
      productId: product?.id ?? null,
      kind: body.kind,
      message: body.message,
      contact: body.contact,
    });
    void reply.status(201);
    return {
      enquiry: publicEnquiry(row, { shopName: shop.name }),
      message: `Done. ${shop.name} has your request for ${ENQUIRY_WORDS[body.kind]}${product ? ` about ${product.name}` : ''}, and will get back to you. Nothing is paid through ${config.productName} for this. You can see it under your past orders.`,
    };
  });

  /** The Shopper's own enquiries to services, newest first, for the order history page. */
  app.get('/me/enquiries', async (request) => {
    const session = requireSession(request, 'shopper');
    const rows = await repository.serviceEnquiries.listForShopper(session.accountId);
    return {
      enquiries: await Promise.all(
        rows.map(async (row) =>
          publicEnquiry(row, {
            shopName: (await repository.partnerShops.findById(row.partnerShopId))?.name ?? '',
          }),
        ),
      ),
    };
  });

  app.get('/shops/:id/products/:productId/photo', async (request, reply) => {
    const { id, productId } = z
      .object({ id: z.string().min(1), productId: z.string().min(1) })
      .parse(request.params);
    const product = await repository.partnerProducts.findById(productId);
    const shop = await repository.partnerShops.findById(id);
    if (
      !product ||
      !shop ||
      !catalogueShown(shop) ||
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

  /* ------------------------------------------------------------------ joining, and paying (ruling 65) */

  app.get('/partner/join/options', async () => joinOptions());

  const joinSchema = z
    .object({
      name: z.string().trim().min(2, 'Please give the business’s name.').max(120),
      kind: z.enum(PARTNER_KINDS),
      address: z.string().trim().min(3, 'Please give the address.').max(300),
      postcode: z
        .string()
        .trim()
        .min(5, 'Please give the postcode.')
        .max(10)
        .regex(
          /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/,
          'That does not look like a UK postcode.',
        ),
      hours: z.string().trim().min(2, 'Please give the opening hours.').max(300),
      contactName: z
        .string()
        .trim()
        .min(2, 'Please give the name of the person to speak to.')
        .max(80),
      mobile: z
        .string()
        .trim()
        .min(7, 'Please give a mobile number.')
        .max(20)
        .regex(
          /^[+0-9 ()-]+$/,
          'A phone number can only have digits, spaces, brackets and a plus.',
        ),
      phoneProof: z.string().trim().max(500).optional(),
      email: z.string().trim().email('Please give an email address.').max(120),
      about: z.string().trim().max(500).default(''),
      username: usernameSchema,
      password: z.string().min(10, 'Please choose a password of at least 10 characters.').max(200),
      /** A shop Ozi listed, being claimed by its owner. */
      claimShopId: z.string().min(1).optional(),
      plan: z.enum(['free', 'plus']).default('free'),
      /**
       * Partner Plus only (ruling 75): true when the shop starts and pays today, skipping the free
       * month, and goes straight to Stripe Checkout; false takes the free month at once.
       */
      payNow: z.boolean().default(false),
      /** The Shop Partner terms at /partner/terms, ticked on the form (30 October 2026). */
      termsAgreed: z.literal(true, {
        errorMap: () => ({ message: 'Please tick to agree to the Shop Partner terms.' }),
      }),
    })
    .merge(browseFieldsSchema);

  /**
   * A shop, café, takeaway or service joins by itself. The mobile is confirmed with a code
   * (the same one-time codes as everybody, role "partner") once codes really go out; the
   * account works at once, in the pending state, and the page goes public once staff approve.
   */
  app.post('/partner/join', async (request, reply) => {
    const body = joinSchema.parse(request.body ?? {});
    const mobile = ukPhone(body.mobile);
    if (!mobile || !isUkMobile(mobile)) {
      throw new BadRequestError('Please give a UK mobile number, starting 07.');
    }
    if (phoneConfirmedAtSignUp(app.ctx)) {
      const proof = body.phoneProof
        ? verifyPhoneProof(body.phoneProof, env.authTokenSecret, now())
        : null;
      if (!proof || proof.role !== 'partner' || proof.phone !== mobile) {
        throw new BadRequestError(
          'Please confirm the mobile number with the code we text it, then try again.',
        );
      }
    }
    const refused = excludedServiceKind(
      `${body.name} ${body.about}`,
      partners.excludedServiceKinds,
    );
    if (refused) throw new BadRequestError(excludedServiceWords(refused, config.productName));
    const browseFields = browseFieldsFor(body.kind, body);
    if (await repository.businessUsers.findByUsername(body.username)) {
      throw new ConflictError('That username is taken. Please choose another.');
    }

    let claimed: PartnerShop | null = null;
    if (body.claimShopId) {
      claimed = await repository.partnerShops.findById(body.claimShopId);
      if (!claimed || !(await claimable(claimed))) {
        throw new ConflictError('That shop has already been claimed, or is not one Ozi listed.');
      }
    }

    // The tiers (ruling 65): a café, takeaway or service never pays monthly; a shop asking for a
    // free listing gets one of the first free-for-ever ones while they last. Once they have all
    // gone, a shop asking for one is told so and chooses again: it is never moved to Partner
    // Plus without choosing it and paying (Anthony, 30 October 2026).
    let plan: PartnerShop['plan'] = 'free';
    let freeForever = false;
    if (body.kind === 'shop') {
      if (body.plan === 'free') {
        if (!freeListingAvailable(await freeListedCount(), partners)) {
          throw new ConflictError(
            `The ${partners.freeListingCount} free listings have all gone, so we cannot give a basic listing now. Nothing has been set up. You can choose Partner Plus, ${money(partners.plusMonthlyPence)} a month${partners.plusFirstMonthFree ? ', with the first month free' : ''}, or ring us.`,
          );
        }
        freeForever = true;
      } else {
        plan = 'plus';
      }
    }
    const details = {
      name: body.name,
      address: body.address,
      telephone: '',
      about: body.about,
      monthlyPence: plan === 'plus' ? partners.plusMonthlyPence : 0,
      kind: body.kind,
      status: 'pending' as const,
      plan,
      freeForever,
      postcode: body.postcode.toUpperCase().replace(/\s+/g, ' ').trim(),
      hours: body.hours,
      contactName: body.contactName,
      mobile,
      email: body.email,
      termsAgreedAt: now(),
      termsVersion: SHOP_PARTNER_TERMS_VERSION,
      ...browseFields,
    };
    const shop = claimed
      ? await repository.partnerShops.update(claimed.id, {
          ...details,
          source: 'claimed',
          approvedAt: null,
        })
      : await repository.partnerShops.create({ ...details, source: 'self' });
    locateLater(app.ctx, shop.postcode, request.log);

    const user = await repository.businessUsers.create({
      kind: 'partner',
      partnerShopId: shop.id,
      organisationId: null,
      name: body.contactName,
      office: '',
      username: body.username,
      passwordHash: hashPassword(body.password),
    });
    await repository.businessUsers.update(user.id, { mustChangePassword: false });
    // A new shop waiting for approval: Ozi rings the owner about it (ruling 74).
    await askOwner(
      app.ctx,
      {
        kind: 'partner_shop',
        subjectId: shop.id,
        summary: `A new ${body.kind === 'service' ? 'service' : body.kind === 'shop' ? 'shop' : 'café or takeaway'}, ${shop.name}, in ${shop.postcode.split(' ')[0] ?? shop.postcode}, has ${claimed ? 'claimed its listing' : 'joined'} and is waiting for approval.`,
        options: 'decide',
      },
      request.log,
    );
    const at = now();

    // Partner Plus chosen at sign-up (ruling 75): the free month starts at once, or, when the
    // shop pays from the start, the free month is set aside and Stripe's page is made now.
    let planMessage = '';
    let checkout: { url: string; receipt: string } | null = null;
    if (body.kind === 'shop' && plan === 'plus') {
      if (body.payNow || !partners.plusFirstMonthFree) {
        const paying = await repository.partnerShops.update(shop.id, { plusTrialUsed: true });
        try {
          const page = await checkoutPage(paying, 'plan', 1, '/partner');
          checkout = { url: page.url, receipt: page.receipt };
          planMessage = ` ${page.message}`;
        } catch {
          planMessage = ` We could not open the payment page just now. Pay for Partner Plus from your dashboard, ${money(partners.plusMonthlyPence)} a month, or ring us.`;
        }
      } else {
        const started = await startFreeMonth(shop);
        planMessage = ` ${started}`;
      }
    }
    void reply.status(201);
    return {
      token: signBusinessToken(
        user.id,
        new Date(at.getTime() + BUSINESS_SESSION_HOURS * 3_600_000),
        env.authTokenSecret,
      ),
      kind: 'partner' as const,
      name: user.name,
      office: '',
      business: shop.name,
      mustChangePassword: false,
      shop: { id: shop.id, status: shop.status, plan: shop.plan, freeForever: shop.freeForever },
      checkout,
      message:
        `Welcome, ${body.contactName}. ${shop.name} is set up${claimed ? ' and claimed' : ''}. You can add ${body.kind === 'service' ? 'services' : 'products'} now; your page goes public once we have checked it, usually within one working day.` +
        (freeForever ? ' Your basic listing is free, with no monthly fee.' : '') +
        planMessage,
    };
  });

  /** The free first month of Partner Plus, taken once: no Stripe at all. Returns what to say. */
  async function startFreeMonth(shop: PartnerShop): Promise<string> {
    const at = now();
    const from = shop.paidUntil && shop.paidUntil > at ? shop.paidUntil : at;
    const updated = await repository.partnerShops.update(shop.id, {
      plan: 'plus',
      monthlyPence: partners.plusMonthlyPence,
      plusTrialUsed: true,
      paidUntil: addMonths(from, 1),
    });
    await repository.partnerPayments.create({
      partnerShopId: shop.id,
      kind: 'plan',
      amountPence: 0,
      months: 1,
      coversUntil: updated.paidUntil ?? at,
      recordedBy: 'first month free',
      paidAt: at,
    });
    return `Partner Plus is on, and your first month is free, until ${longDay(updated.paidUntil ?? at)}. After that it is ${money(partners.plusMonthlyPence)} a month, paid here whenever you choose; nothing is ever taken without you.`;
  }

  /**
   * A Stripe Checkout page for Partner Plus, Spotlight or Spotlight Plus, the pattern a telephone
   * order's link uses (`purpose: 'partner'`), with the signed receipt the dashboard sends back.
   */
  async function checkoutPage(
    shop: PartnerShop,
    kind: PartnerPayment['kind'],
    months: number,
    returnTo: string,
  ) {
    const at = now();
    const price =
      kind === 'plan'
        ? partners.plusMonthlyPence
        : kind === 'plus'
          ? config.extras.spotlightPlusPence
          : config.extras.spotlightPence;
    const amountPence = price * months;
    const origin = env.primaryOrigin ?? '';
    const path = returnTo.startsWith('/') ? returnTo : '/partner';
    // Stripe fills in the session's id where it sees this exact text.
    const placeholder = '{CHECKOUT_SESSION_ID}';
    const reference = `partner:${shop.id}:${kind}:${at.getTime()}`;
    const link = await app.ctx.payments.createPaymentLink({
      orderId: reference,
      purpose: 'partner',
      amountPence,
      currency: config.fees.currency,
      description: `${config.productName}: ${PAYMENT_WORDS[kind]} for ${shop.name}, ${months} month${months === 1 ? '' : 's'}`,
      customerId: null,
      successUrl: `${origin}${path}?paid=${placeholder}`,
      cancelUrl: `${origin}${path}`,
      expiresAt: Math.floor(at.getTime() / 1000) + CHECKOUT_HOURS * 3600,
    });
    return {
      url: link.url,
      receipt: signPartnerCheckout(
        { sessionId: link.id, partnerShopId: shop.id, kind, months, amountPence },
        env.authTokenSecret,
      ),
      message: `Taking you to pay ${money(amountPence)} for ${PAYMENT_WORDS[kind]}. Your card is given to Stripe, never to us.`,
    };
  }

  /**
   * Paying for Partner Plus, Spotlight or Spotlight Plus from the dashboard (ruling 65), through
   * the same Stripe Checkout page as a telephone order's link. The first month of Partner Plus
   * is free and needs no Stripe at all. The dashboard records the payment when Stripe sends
   * the shop back with the signed receipt, so nothing waits on the server meanwhile.
   */
  app.post('/partner/plan/checkout', async (request) => {
    const shop = await myShop(request);
    const body = z
      .object({
        kind: z.enum(['plan', 'spotlight', 'plus']).default('plan'),
        months: z.number().int().min(1).max(12).default(1),
        returnTo: z.string().trim().max(300).default('/partner'),
      })
      .parse(request.body ?? {});
    if (shop.kind !== 'shop' && body.kind === 'plan') {
      throw new BadRequestError(
        shop.kind === 'food'
          ? `A café or takeaway pays no monthly fee: ${basisPointsWords(partners.foodCommissionBasisPoints)} of each order through ${config.productName} instead.`
          : 'A service is listed free. There is nothing to pay.',
      );
    }
    if (body.kind !== 'plan' && !(shop.plan === 'plus' && planPaid(shop))) {
      throw new ConflictError('Spotlight is only for shops on Partner Plus whose plan is paid.');
    }
    if (body.kind === 'plan' && partners.plusFirstMonthFree && !shop.plusTrialUsed) {
      return { url: null, message: await startFreeMonth(shop) };
    }
    return checkoutPage(shop, body.kind, body.months, body.returnTo);
  });

  /** Back from Stripe: checks the page was paid and records it, once. */
  app.post('/partner/plan/confirm', async (request) => {
    const shop = await myShop(request);
    const { receipt, sessionId } = z
      .object({ receipt: z.string().min(1).max(2000), sessionId: z.string().min(1).max(200) })
      .parse(request.body ?? {});
    const checkout = verifyPartnerCheckout(receipt, env.authTokenSecret);
    if (!checkout || checkout.partnerShopId !== shop.id || checkout.sessionId !== sessionId) {
      throw new BadRequestError('That receipt is not for this shop.');
    }
    if (await repository.partnerPayments.findByReference(checkout.sessionId)) {
      return { recorded: false, message: 'That payment was already recorded. Thank you.' };
    }
    const paid = await app.ctx.payments.paidByLink(checkout.sessionId);
    if (!paid) {
      throw new ConflictError(
        'Stripe has not confirmed that payment yet. Try again in a minute, or ring us.',
      );
    }
    const at = now();
    let updated: PartnerShop;
    if (checkout.kind === 'plan') {
      const from = shop.paidUntil && shop.paidUntil > at ? shop.paidUntil : at;
      updated = await repository.partnerShops.update(shop.id, {
        plan: 'plus',
        monthlyPence: partners.plusMonthlyPence,
        paidUntil: addMonths(from, checkout.months),
      });
    } else {
      const sameLevel =
        shop.spotlight === checkout.kind && shop.spotlightUntil && shop.spotlightUntil > at;
      const from = sameLevel && shop.spotlightUntil ? shop.spotlightUntil : at;
      updated = await repository.partnerShops.update(shop.id, {
        spotlight: checkout.kind,
        spotlightUntil: addMonths(from, checkout.months),
      });
    }
    const until = (checkout.kind === 'plan' ? updated.paidUntil : updated.spotlightUntil) ?? at;
    await repository.partnerPayments.create({
      partnerShopId: shop.id,
      kind: checkout.kind,
      amountPence: checkout.amountPence,
      months: checkout.months,
      coversUntil: until,
      recordedBy: 'paid online',
      paidAt: at,
      reference: checkout.sessionId,
    });
    return {
      recorded: true,
      message: `Thank you. ${PAYMENT_WORDS[checkout.kind]} is paid, ${money(checkout.amountPence)}, until ${longDay(until)}.`,
    };
  });

  /** A service answers an enquiry: marks it answered, with a note the Shopper sees. */
  app.post('/partner/enquiries/:id/answer', async (request) => {
    const shop = await myShop(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const { reply: note } = z
      .object({ reply: z.string().trim().max(600).default('') })
      .parse(request.body ?? {});
    const row = await repository.serviceEnquiries.findById(id);
    if (!row || row.partnerShopId !== shop.id) throw new NotFoundError('enquiry');
    const updated = await repository.serviceEnquiries.update(row.id, {
      status: 'answered',
      reply: note || null,
      answeredAt: now(),
    });
    return {
      enquiry: publicEnquiry(updated, {}),
      message: 'Marked as answered. The Shopper sees that under their past orders.',
    };
  });

  /* ------------------------------------------------------------------ organisations */

  /**
   * What an organisation may see of a person (UK GDPR; Anthony, 30 October 2026): only the
   * orders they placed after agreeing to link, and their booked weekly shops while they agree.
   * Somebody linked before consent was recorded shows nothing until they agree again.
   */
  function sharedSince(person: Shopper): Date | null {
    return person.organisationConsentAt;
  }

  async function sharedOrders(person: Shopper): Promise<Order[]> {
    const since = sharedSince(person);
    if (!since) return [];
    return (await repository.orders.listForShopper(person.id)).filter(
      (order) => PAID_STATUSES.has(order.status) && order.createdAt.getTime() >= since.getTime(),
    );
  }

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
      feePence: number;
      /** The extra delivery charge past the client's monthly allowance (ruling 73), or 0. */
      allowanceExtraPence: number;
    }> = [];
    const upcoming: Array<{
      person: string;
      office: string;
      dayOfWeek: number;
      estimatePence: number;
    }> = [];
    for (const person of people) {
      for (const order of await sharedOrders(person)) {
        orders.push({
          id: order.id,
          person: person.displayName,
          office: person.organisationOffice ?? '',
          createdAt: order.createdAt,
          status: order.status,
          items: order.items.reduce((sum, item) => sum + item.quantity, 0),
          paidPence: paidAmount(order),
          feePence: order.feePence,
          allowanceExtraPence: order.allowanceExtraPence,
        });
      }
      const sets = sharedSince(person) ? await repository.sets.listForShopper(person.id) : [];
      for (const set of sets) {
        if (!set.active) continue;
        // The people an organisation looks after have Membership delivery, by the value of the
        // shopping (rulings 58 and 63), and item charges on every unit.
        const goodsPence = set.items.reduce(
          (sum, item) => sum + item.estimatedPricePence * item.quantity,
          0,
        );
        upcoming.push({
          person: person.displayName,
          office: person.organisationOffice ?? '',
          dayOfWeek: set.dayOfWeek,
          estimatePence:
            set.items.reduce(
              (sum, item) =>
                sum + displayPricePence(item.estimatedPricePence, config.fees) * item.quantity,
              0,
            ) + deliveryFeePence(goodsPence, 'membership', config.fees),
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
    // Savings, from the organisation's own figure for what a staff trip to the shops costs them,
    // against what each delivery actually cost (Membership delivery, by the value of the shop,
    // with any extra delivery charge past the client's monthly allowance, ruling 73).
    const tripCost = organisation.staffTripCostPence;
    const savedThisMonth =
      tripCost === null
        ? null
        : thisMonth.reduce(
            (total, row) => total + Math.max(0, tripCost - row.feePence - row.allowanceExtraPence),
            0,
          );

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
        // Linked before consent was recorded: nothing of theirs shows until they agree again.
        agreed: person.organisationConsentAt !== null,
      })),
      orders: orders.slice(0, 200),
      upcoming,
      // The Membership delivery for an everyday shop (the smallest band); a bigger shop pays
      // its band's price, which each order's own figure above reflects.
      deliveryFeePence: deliveryFeePence(0, 'membership', config.fees),
      deliveryWords: deliveryStepsWords('membership', config.fees, money),
      // Each client's monthly allowance on Membership delivery (ruling 73), in words.
      allowanceWords: allowancePlanWords('membership', config.fees.delivery.allowance, money),
      // What the organisation pays a month for the people it looks after (ruling 58).
      plan: organisationPlan(people.length),
      sharePath: organisation.joinCode ? `/join/organisation/${organisation.joinCode}` : null,
      // Everybody linked, and everybody who opened an account by the link but has not linked
      // yet: somebody who did both is counted once (30 October 2026).
      referrals: organisation.joinCode
        ? (await countJoinedVia(`organisation:${organisation.joinCode}`)) +
          people.filter((person) => person.joinedVia !== `organisation:${organisation.joinCode}`)
            .length
        : people.length,
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
        (discounted > 0
          ? ` and ${discounted} at ${money(pricing.discountedClientMonthlyPence)}`
          : '') +
        `, ${money(monthlyPence)} a month. Every ${ordinal(pricing.discountEveryNthClient)} client is ${money(pricing.discountedClientMonthlyPence)}. Each client's orders have the item charges and Membership delivery: ${deliveryStepsWords('membership', config.fees, money)}. Each client has ${allowancePlanWords('membership', config.fees.delivery.allowance, money) ?? ''}.`,
    };
  }

  app.get('/organisation/statement.pdf', async (request, reply) => {
    const { organisation } = await myOrganisation(request);
    const people = await repository.organisations.listServiceUsers(organisation.id);
    const rows: Array<{ at: Date; line: string; pence: number }> = [];
    for (const person of people) {
      for (const order of await sharedOrders(person)) {
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
      ...companyLines(),
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
    await repository.shoppers.update(person.id, {
      organisationId: null,
      organisationOffice: null,
      organisationConsentAt: null,
      organisationConsentVersion: null,
    });
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
    const { code, version } = z
      .object({
        code: z.string().trim().min(4, 'Please type the code the organisation gave you.').max(20),
        agreed: z.literal(true, {
          errorMap: () => ({
            message:
              'Please agree first to what the organisation will see. Only you, or someone with legal authority to act for you, may agree.',
          }),
        }),
        /** The consent wording shown (ORGANISATION_CONSENT_VERSION); an older screen is refused. */
        version: z.string().trim().max(80).optional(),
      })
      .parse(request.body ?? {});
    const organisation = await repository.organisations.findByJoinCode(
      code.toUpperCase().replace(/[^A-Z0-9]/g, ''),
    );
    if (!organisation || !organisation.active)
      throw new NotFoundError('organisation with that code');
    if (version !== undefined && version !== ORGANISATION_CONSENT_VERSION) {
      throw new ConflictError(
        'The words about what is shared have changed. Please reload the page, read them again and agree.',
      );
    }
    // The moment they agreed, and to which words (UK GDPR): the organisation sees only orders
    // placed from now on (30 October 2026).
    await repository.shoppers.update(session.accountId, {
      organisationId: organisation.id,
      organisationOffice: null,
      organisationConsentAt: now(),
      organisationConsentVersion: ORGANISATION_CONSENT_VERSION,
    });
    return {
      organisation: { name: organisation.name },
      message: `You're now linked to ${organisation.name}. They can see your name, the office label they give you, the weekly shops you have booked, and the orders you place from now on with what they cost. They pay us their own fee for you, and your delivery is the Membership price. You can stop this at any time in Settings.`,
    };
  });

  app.post('/me/organisation/leave', async (request) => {
    const session = requireSession(request, 'shopper');
    await repository.shoppers.update(session.accountId, {
      organisationId: null,
      organisationOffice: null,
      organisationConsentAt: null,
      organisationConsentVersion: null,
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
      const { mobile, ...rest } = shop;
      shops.push({
        ...rest,
        hasMobile: mobile !== '',
        kindWords: PARTNER_KIND_WORDS[shop.kind],
        area: postcodeArea(shop.postcode),
        listed: listed(shop),
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
      plusMonthlyPence: partners.plusMonthlyPence,
      freeListingCount: partners.freeListingCount,
      freeListed: await freeListedCount(),
      freeProductLimit: partners.freeProductLimit,
      foodCommissionWords: basisPointsWords(partners.foodCommissionBasisPoints),
      spotlightPence: config.extras.spotlightPence,
      spotlightPlusPence: config.extras.spotlightPlusPence,
      seedShops: loadShopsSeed(env.storeConfigPath).length,
    };
  });

  /** The shops Ozi lists itself, from config/shops-seed.json: adds only the ones not there. */
  app.post('/staff/partners/seed', async (request) => {
    await staffActor(request, 'partners');
    const result = await seedShops(repository, loadShopsSeed(env.storeConfigPath), now);
    return {
      ...result,
      message:
        result.added === 0
          ? 'Every seed shop is already listed. Nothing to add.'
          : `${result.added} shop${result.added === 1 ? '' : 's'} listed by ${config.assistantName}, each with no products of its own and an invitation to its owner to claim it.`,
    };
  });

  app.post('/staff/partners', async (request, reply) => {
    const actor = await staffActor(request, 'partners');
    const body = z
      .object({
        name: z.string().trim().min(2, 'Please give the shop’s name.').max(120),
        kind: z.enum(PARTNER_KINDS).default('shop'),
        address: z.string().trim().max(300).default(''),
        postcode: z.string().trim().max(10).default(''),
        hours: z.string().trim().max(300).default(''),
        contactName: z.string().trim().max(80).default(''),
        mobile: z.string().trim().max(20).default(''),
        email: z.string().trim().max(120).default(''),
        telephone: z.string().trim().max(30).default(''),
        about: z.string().trim().max(500).default(''),
        plan: z.enum(['free', 'plus']).default('free'),
        monthlyPence: z.number().int().min(0).max(1_000_000).optional(),
        /** Months of Partner Plus already paid on paper. */
        paidMonths: z.number().int().min(0).max(24).default(0),
      })
      .merge(browseFieldsSchema)
      .parse(request.body ?? {});
    const refused = excludedServiceKind(
      `${body.name} ${body.about}`,
      partners.excludedServiceKinds,
    );
    if (refused) throw new BadRequestError(excludedServiceWords(refused, config.productName));
    const browseFields = browseFieldsFor(body.kind, body);
    // Added by staff from a paper form (ruling 65): the agreement is on paper, so it is approved.
    const plan = body.kind !== 'shop' ? 'free' : body.paidMonths > 0 ? 'plus' : body.plan;
    const shop = await repository.partnerShops.create({
      name: body.name,
      kind: body.kind,
      address: body.address,
      postcode: body.postcode.toUpperCase(),
      hours: body.hours,
      contactName: body.contactName,
      mobile: ukPhone(body.mobile) ?? body.mobile,
      email: body.email,
      telephone: body.telephone,
      about: body.about,
      plan,
      freeForever:
        body.kind === 'shop' &&
        plan === 'free' &&
        freeListingAvailable(await freeListedCount(), partners),
      monthlyPence: plan === 'plus' ? (body.monthlyPence ?? partners.plusMonthlyPence) : 0,
      status: 'approved',
      source: 'staff',
      approvedAt: now(),
      ...browseFields,
    });
    locateLater(app.ctx, shop.postcode, request.log);
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
        /** Pause (false) or resume (true). */
        active: z.boolean().optional(),
        /** Approve a pending listing, or remove one. */
        status: z.enum(['approved', 'pending', 'removed']).optional(),
      })
      .merge(browseFieldsSchema)
      .parse(request.body ?? {});
    const shop = await repository.partnerShops.findById(id);
    if (!shop) throw new NotFoundError('partner shop');
    const at = now();
    let updated = shop;
    // What it is browsed under (ruling 82), set by staff when adding or approving a shop.
    const browseKeys = [
      'cuisines',
      'specialities',
      'categories',
      'convenience',
      'ofstedNumber',
    ] as const;
    if (browseKeys.some((key) => body[key] !== undefined)) {
      updated = await repository.partnerShops.update(
        shop.id,
        browseFieldsFor(shop.kind, body, shop),
      );
    }
    if (body.status !== undefined) {
      updated = await repository.partnerShops.update(shop.id, {
        status: body.status,
        approvedAt: body.status === 'approved' ? (shop.approvedAt ?? at) : shop.approvedAt,
        ...(body.status === 'removed' ? { active: false } : {}),
      });
    }
    if (body.paidMonths) {
      if (body.kind === 'plan') {
        const from = shop.paidUntil && shop.paidUntil > at ? shop.paidUntil : at;
        updated = await repository.partnerShops.update(shop.id, {
          plan: 'plus',
          monthlyPence: shop.monthlyPence || partners.plusMonthlyPence,
          paidUntil: addMonths(from, body.paidMonths),
        });
        await repository.partnerPayments.create({
          partnerShopId: shop.id,
          kind: 'plan',
          amountPence: (shop.monthlyPence || partners.plusMonthlyPence) * body.paidMonths,
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
    const actor = await staffActor(request, 'partners');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({ approve: z.boolean(), note: z.string().trim().max(300).optional() })
      .parse(request.body ?? {});
    const product = await repository.partnerProducts.findById(id);
    if (!product) throw new NotFoundError('product');
    // The same decision Ozi's desk makes on the owner's keypad (services/partner-products.ts).
    const updated = await decidePartnerProduct(app.ctx, product, {
      approve: body.approve,
      note: body.note ?? null,
    });
    await settleMattersFor(app.ctx, 'partner_product', product.id, 'panel', actor.name);
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
        /** Where it is, which gives its area (Anthony, 30 October 2026). */
        postcode: z
          .string()
          .trim()
          .max(10)
          .transform((value) => tidyPostcode(value))
          .optional(),
      })
      .parse(request.body ?? {});
    const organisation = await repository.organisations.create(body);
    if (body.postcode) locateLater(app.ctx, body.postcode, request.log);
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
