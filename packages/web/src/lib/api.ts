/**
 * Talking to the API.
 *
 * The shell works without it: every screen has something sensible to show when the server
 * is not running, and says so in plain words rather than spinning forever or showing a
 * stack trace.
 */

import { ORGANISATION_CONSENT_VERSION } from '@aldilivery/core';

import { storeConfig } from '../config';
import { readRunnerToken, readToken } from './session';

export interface CatalogueItem {
  id: string;
  name: string;
  category: string;
  estimatedPricePence: number;
  /**
   * The restaurant, café or takeaway a dish is from (Anthony, 30 October 2026), or null for
   * everything else. A basket of one restaurant's dishes is a restaurant order.
   */
  restaurant?: { shopId: string; name: string; markedUp?: boolean } | null;
}

export interface CatalogueResult {
  items: CatalogueItem[];
  attribution: string;
  source: string;
  /** Said with the results when a Preferred Partner's dish is ranked first (CMA). */
  ranking?: string | null;
}

/**
 * Where the API lives. Baked in at build time from `VITE_API_URL`.
 *
 * On DigitalOcean the web app and the API sit behind one hostname, so this is set to `/api`
 * and no request ever leaves the origin. On a developer's machine, with nothing set, it is
 * the API running locally on port 8080. A trailing slash is trimmed so that `/api/` and
 * `/api` cannot produce two different URLs for the same route.
 */
const LOCAL_API_URL = 'http://localhost:8080';

const BASE_URL = String(
  import.meta.env['VITE_API_URL'] ?? (import.meta.env.DEV ? LOCAL_API_URL : '/api'),
).replace(/\/+$/, '');

export class ApiUnavailableError extends Error {
  /**
   * `reason` is for the console and for us. The message a person sees stays the same plain
   * sentence however the API failed to answer, because "we cannot reach it" is the whole of
   * what a Shopper needs to know.
   */
  constructor(
    readonly reason = 'no answer',
    readonly status?: number,
  ) {
    super(`We cannot reach ${storeConfig.productName} at the moment.`);
    this.name = 'ApiUnavailableError';
  }
}

/**
 * Did something other than the API answer?
 *
 * When the API is redeploying, or a route is misconfigured, a request to `/api/...` can fall
 * through to whatever serves the rest of the site and come back as the web app's own HTML
 * page, with a perfectly cheerful 200 on it. Parsing that as JSON gives an empty object, and
 * an empty object looks exactly like a shop with nothing in it. A blank catalogue that should
 * have been an error message is the worst of both: nothing works and nothing says why.
 */
function isNotJson(response: Response): boolean {
  const contentType = response.headers?.get?.('content-type');
  // No header at all is not evidence of a problem; the wrong one is.
  return typeof contentType === 'string' && !contentType.includes('json');
}

/**
 * The server said no, in words. `status` and `details` are there for the screens that act on
 * the kind of no — a PIN that has not been chosen yet, say — rather than only showing it.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: Record<string, unknown> | undefined,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(
  path: string,
  init?: RequestInit,
  as: 'shopper' | 'runner' = 'shopper',
): Promise<T> {
  let response: Response;
  try {
    const token = as === 'runner' ? readRunnerToken() : readToken();
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        // Only sent when there is one. An anonymous browse must stay anonymous.
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (failure) {
    throw new ApiUnavailableError(
      `no answer${failure instanceof Error && failure.message ? ` (${failure.message})` : ''}`,
    );
  }

  if (isNotJson(response)) {
    throw new ApiUnavailableError('the reply was not JSON', response.status);
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    // A body that will not parse is not an empty body. Saying so is the whole point.
    if (response.ok) throw new ApiUnavailableError('the reply could not be read', response.status);
    parsed = {};
  }

  type Refusal = { error?: { message?: string; details?: Record<string, unknown> } };
  const body = parsed as T | Refusal;

  if (!response.ok) {
    const refusal = (body as Refusal).error;
    throw new ApiError(
      refusal?.message ?? 'Something went wrong. Nothing has been charged.',
      response.status,
      refusal?.details,
    );
  }

  return body as T;
}

export function searchCatalogue(query: string): Promise<CatalogueResult> {
  return request<CatalogueResult>(`/catalogue/search?q=${encodeURIComponent(query)}`);
}

/**
 * Something not in the shop list (19 October 2026): added at a typical price, or the cafés that
 * make it, or why it is never carried. "unknown" when the server cannot say.
 */
export type ItemSuggestion =
  | { outcome: 'found' | 'added'; item: CatalogueItem }
  | {
      outcome: 'shops';
      reply: string;
      /** Ozi Preferred Partners first, each marked (30 October 2026). */
      shops: Array<{ id: string; name: string; preferred?: boolean }>;
    }
  | { outcome: 'refused'; reply: string }
  | { outcome: 'unknown' };

export function suggestItem(name: string): Promise<ItemSuggestion> {
  return request<ItemSuggestion>('/catalogue/suggest', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export interface BasketPrice {
  goodsEstimatePence: number;
  itemChargesPence: number;
  feePence: number;
  /** The extra delivery charge past the monthly allowance (ruling 73), when there is one. */
  allowanceExtraPence?: number;
  totalPence: number;
  explanation: string[];
}

/**
 * Checkout insights (30 October 2026): the Confirm page says it was reached, with the breakdown it
 * showed. Never a card detail. A failure never stops the checkout.
 */
export function recordCheckoutViewed(view: {
  goodsPence: number;
  itemChargesPence: number;
  feePence: number;
  totalPence: number;
  restaurant: boolean;
  area: string;
  noRunnerWarning: boolean;
  channel: 'web' | 'voice';
}): Promise<{ recorded: boolean }> {
  return request('/checkout/viewed', { method: 'POST', body: JSON.stringify(view) });
}

export type CheckoutReason = 'price' | 'looking' | 'no_runner' | 'other';

/** Whether to ask "Can we ask what stopped you?" now: at most once a day, said by the server. */
export function askWhyStopped(): Promise<{
  ask: boolean;
  question: string;
  answers: Array<{ answer: CheckoutReason; label: string }>;
}> {
  return request('/checkout/why/ask', { method: 'POST', body: JSON.stringify({}) });
}

/** The answer tapped. Skipping sends nothing. */
export function answerWhyStopped(input: {
  answer: CheckoutReason;
  restaurant: boolean;
  totalPence: number;
  area: string;
}): Promise<{ recorded: boolean; message: string }> {
  return request('/checkout/why', { method: 'POST', body: JSON.stringify(input) });
}

export function priceBasketRemotely(
  lines: Array<{ catalogueItemId: string; quantity: number }>,
  /** Booked for a later day (ruling 78): it counts in the month it is delivered in. */
  deliveryDay?: string,
): Promise<BasketPrice> {
  return request<BasketPrice>('/basket/price', {
    method: 'POST',
    body: JSON.stringify(deliveryDay ? { lines, deliveryDay } : { lines }),
  });
}

/* ------------------------------------------------------------------------------------- *
 * The account
 * ------------------------------------------------------------------------------------- */

export type SubstitutionChoice = 'no_substitutes' | 'similar_item' | 'ask_me';

export interface Shopper {
  id: string;
  /** The app store reviewers' demo account (ruling 60): no real orders. */
  isDemo?: boolean;
  /** Ozi Recipes is unlocked until then (ISO date), or never bought. */
  recipePassUntil?: string | null;
  /** The monthly plan chosen (ruling 58), and until when it is paid up. */
  plan?: 'membership' | 'plus' | 'family' | null;
  planUntil?: string | null;
  /** Which delivery price applies now: the server decides, the basket follows. */
  deliveryPlan?: import('@aldilivery/core').DeliveryPlan;
  activePlan?: 'membership' | 'plus' | 'family' | null;
  inFreeMonth?: boolean;
  freeMonthUntil?: string | null;
  /** Recipes and a free Finds It a month: on any plan and in the free month. */
  membershipExtras?: boolean;
  /** Plus and Family: no adverts. */
  plusExtras?: boolean;
  /** Which monthly order allowance applies now (ruling 73): the server decides. */
  allowancePlan?: import('@aldilivery/core').AllowancePlan;
  /** The Shopper's own orders that count towards it so far this calendar month. */
  ordersThisMonth?: number;
  /** On somebody else's Family and Carer plan, whose card pays. */
  familyOwnerId?: string | null;
  creditPence?: number;
  /** Ruling 61: how much of the credit is a further Runner's delivery that was not needed. */
  unusedRunnerFeeCreditPence?: number;
  ageBand?: 'under_25' | '25_44' | '45_64' | '65_plus' | null;
  displayName: string;
  handle: string;
  phone: string;
  doorstepProtocol: string;
  deliveryAddress: string;
  substitutionDefault: SubstitutionChoice;
  budgetCapPence: number | null;
  /** Whether a PIN has been chosen. The PIN itself never leaves the server. */
  hasPin?: boolean;
  /** Set when the account is closing: it is removed on this day unless kept. */
  deletionScheduledFor?: string | null;
}

export interface RegisterShopperInput {
  displayName: string;
  phone: string;
  deliveryAddress: string;
  doorstepProtocol?: string;
  substitutionDefault?: SubstitutionChoice;
  /** From verifying the code sent to the number, once numbers are confirmed at sign-up. */
  phoneProof?: string;
  /** "Did someone introduce you? Their code (optional)" (30 October 2026). */
  introducedBy?: string;
}

/**
 * Setting up an account. The server answers with a session token as well as the Shopper,
 * which is what keeps somebody signed in afterwards — see `lib/session.ts` for why that is
 * the whole of the sign-in story for now.
 */
export function registerShopper(
  input: RegisterShopperInput,
): Promise<{ shopper: Shopper; token: string }> {
  // The share link they came by, if any, so the shop or organisation that shared it is counted.
  const via = joinedVia();
  return request<{ shopper: Shopper; token: string }>('/shoppers', {
    method: 'POST',
    body: JSON.stringify(via ? { ...input, joinedVia: via } : input),
  }).then((made) => {
    // Its only job is done: nothing about where somebody came from stays on their device
    // (the page "What we keep on your device", ruling 54).
    forgetJoinedVia();
    return made;
  });
}

const JOINED_VIA = 'ozidelivery.joined.via';

/** Remembers which share link brought someone here: partner, organisation, staff or shopper. */
export function rememberJoinedVia(via: string): void {
  try {
    window.localStorage.setItem(JOINED_VIA, via);
  } catch {
    // Not counted, which is harmless.
  }
}

export function forgetJoinedVia(): void {
  try {
    window.localStorage.removeItem(JOINED_VIA);
  } catch {
    // Nothing to forget.
  }
}

/**
 * The referral link that brought someone here, kept until they finish signing up, whatever they
 * sign up as (Anthony, 30 October 2026): a Shopper, a Runner, a shop or an organisation.
 */
export function joinedVia(): string | null {
  try {
    return window.localStorage.getItem(JOINED_VIA);
  } catch {
    return null;
  }
}

const AMBASSADOR = 'ozidelivery.joined.ambassador';

/** The Ozi Ambassador whose link brought a business to /business/join, kept until it joins. */
export function rememberAmbassador(via: string): void {
  try {
    window.localStorage.setItem(AMBASSADOR, via);
  } catch {
    // Not tied, which is harmless.
  }
}

export function ambassadorVia(): string | null {
  try {
    return window.localStorage.getItem(AMBASSADOR);
  } catch {
    return null;
  }
}

function forgetAmbassador(): void {
  try {
    window.localStorage.removeItem(AMBASSADOR);
  } catch {
    // Nothing to forget.
  }
}

/* ------------------------------------------------------------------------------------- *
 * Signing back in, with a code sent by text
 * ------------------------------------------------------------------------------------- */

export interface SignInOptions {
  /** A code by text, to a mobile. */
  byText: boolean;
  /** A code spoken by an automatic phone call, for a landline. */
  byCall: boolean;
  /** Whether a new account's number must be confirmed with a code (ruling 33). */
  confirmAtSignUp: boolean;
}

export function fetchSignInOptions(): Promise<SignInOptions> {
  return request<{ signIn?: Partial<SignInOptions> }>('/config').then((body) => ({
    byText: body.signIn?.byText ?? false,
    byCall: body.signIn?.byCall ?? false,
    confirmAtSignUp: body.signIn?.confirmAtSignUp ?? false,
  }));
}

/** Whether the server can send a code at all. False until Twilio is set up in production. */
export function fetchSignInAvailable(): Promise<boolean> {
  return fetchSignInOptions().then((options) => options.byText || options.byCall);
}

/** A British mobile number, which can get a text; anything else is a landline, rung instead. */
export function isUkMobileNumber(phone: string): boolean {
  const digits = phone.replace(/[^\d+]/g, '');
  return /^(\+44|0044|0)7\d{9}$/.test(digits);
}

/**
 * Who is signing in: a Shopper, or a Runner on a new phone (16 October 2026); or a shop joining
 * as a partner, confirming its mobile with the same code (ruling 65), which never gets a session.
 */
export type SignInRole = 'shopper' | 'runner' | 'partner';

export function requestSignInCode(
  phone: string,
  options: { channel?: 'text' | 'call'; purpose?: 'sign-in' | 'sign-up'; role?: SignInRole } = {},
): Promise<{ message: string }> {
  return request<{ message: string }>('/auth/request-code', {
    method: 'POST',
    body: JSON.stringify({
      phone,
      role: options.role ?? 'shopper',
      channel: options.channel ?? 'text',
      purpose: options.purpose ?? 'sign-in',
    }),
  });
}

export type SignInResult =
  | { registrationRequired: false; token: string }
  | { registrationRequired: true; phone: string; message: string; phoneProof?: string };

export function verifySignInCode(
  phone: string,
  code: string,
  role: SignInRole = 'shopper',
): Promise<SignInResult> {
  return request<SignInResult>('/auth/verify-code', {
    method: 'POST',
    body: JSON.stringify({ phone, code, role }),
  });
}

/* ------------------------------------------------------------------------------------- *
 * Runners
 * ------------------------------------------------------------------------------------- */

export type VehicleType = 'on_foot' | 'bicycle' | 'motorbike' | 'car' | 'van';

export interface RegisterRunnerInput {
  name: string;
  phone: string;
  /** Every way they might deliver: tick all, so switching later needs nothing new. */
  travelModes: VehicleType[];
  /** The ID of whoever invited them, from the link they followed. */
  referredBy?: string;
  /** Anybody's referral link they came by, as kind:code (30 October 2026). */
  joinedVia?: string;
  /** Agreeing to the Runner agreement as they sign up (ruling 55). */
  agreement?: { accepted: true; version: string; channel: 'button' | 'voice' };
  /** The tick "I am 18 or over", kept by the server with its time (30 October 2026). */
  adult: true;
  /** Where they live, which gives their area: they are offered jobs only there. */
  homePostcode: string;
  /** "Did someone introduce you? Their code (optional)" (30 October 2026). */
  introducedBy?: string;
}

/**
 * Signing up to run. The token that comes back is kept as the Runner's, separately from any
 * Shopper signed in on the same browser — see `readRunnerToken`.
 */
export function registerRunner(
  input: RegisterRunnerInput,
): Promise<{ runner: { name: string; phone: string; referralCode: string }; token: string }> {
  // Anybody's link they came by, a Shopper's say, is counted for them too (30 October 2026). A
  // Runner's own link is already sent as `referredBy`, so it is not sent twice.
  const kept = input.joinedVia ?? joinedVia();
  const via =
    kept && input.referredBy && kept === `runner:${input.referredBy.toUpperCase()}` ? null : kept;
  return request<{ runner: { name: string; phone: string; referralCode: string }; token: string }>(
    '/runners',
    {
      method: 'POST',
      body: JSON.stringify(via ? { ...input, joinedVia: via } : input),
    },
  ).then((made) => {
    forgetJoinedVia();
    return made;
  });
}

export interface RunnerAccount {
  id: string;
  name: string;
  phone: string;
  rightToWorkVerified: boolean;
  criminalRecordCheckVerified: boolean;
  available: boolean;
  /** How they are delivering now. */
  vehicleType?: VehicleType;
  travelModes?: VehicleType[];
  referralCode?: string;
  /** They have agreed to the Runner agreement as it stands today (ruling 55). */
  agreementCurrent?: boolean;
  agreementAcceptedAt?: string | null;
  agreementVersion?: string | null;
  /** The app store reviewers' demo Runner (ruling 60). */
  isDemo?: boolean;
  /** Where they live, which gives their area (30 October 2026). Empty until given. */
  homePostcode?: string;
  /** When a person accepted their face photo; null until then. */
  facePhotoAcceptedAt?: string | null;
}

/** Agreeing to the Runner agreement before the first job (ruling 55). */
export function agreeToRunnerAgreement(
  version: string,
  channel: 'button' | 'voice' = 'button',
): Promise<{ runner: RunnerAccount; message: string }> {
  return request<{ runner: RunnerAccount; message: string }>(
    '/runners/me/agreement',
    { method: 'POST', body: JSON.stringify({ accepted: true, version, channel }) },
    'runner',
  );
}

export type RunnerDocumentKind =
  | 'face_photo'
  | 'right_to_work'
  | 'dbs'
  | 'driving_licence_front'
  | 'driving_licence_back'
  | 'insurance';

export interface RunnerDocumentRecord {
  id: string;
  kind: RunnerDocumentKind;
  name: string;
  status: 'submitted' | 'accepted' | 'rejected';
  reviewNote: string | null;
  sentAs: 'photo' | 'share code' | 'PDF';
  createdAt: string;
}

export interface RunnerDocuments {
  documents: RunnerDocumentRecord[];
  stillNeeded: Array<{ kind: RunnerDocumentKind; name: string }>;
  /** They agreed their face photo may be compared with the photo on their ID (ruling 74). */
  faceMatchConsent?: boolean;
}

export function setFaceMatchConsent(
  agree: boolean,
): Promise<{ faceMatchConsent: boolean; message: string }> {
  return request<{ faceMatchConsent: boolean; message: string }>(
    '/runners/me/face-match-consent',
    { method: 'POST', body: JSON.stringify({ agree }) },
    'runner',
  );
}

export function fetchRunnerDocuments(): Promise<RunnerDocuments> {
  return request<RunnerDocuments>('/runners/me/documents', undefined, 'runner');
}

export function sendRunnerDocument(input: {
  kind: RunnerDocumentKind;
  image?: string;
  contentType?: string;
  shareCode?: string;
  expiresOn?: string;
}): Promise<RunnerDocuments & { message: string }> {
  return request<RunnerDocuments & { message: string }>(
    '/runners/me/documents',
    { method: 'POST', body: JSON.stringify(input) },
    'runner',
  );
}

export function setTravelMode(mode: VehicleType): Promise<{ message: string }> {
  return request<{ message: string }>(
    '/runners/me/travel-mode',
    { method: 'POST', body: JSON.stringify({ mode }) },
    'runner',
  );
}

export interface RunnerDashboard {
  runnerId: string;
  shareLink: string;
  travelling: VehicleType;
  travelModes: VehicleType[];
  canDrive: boolean;
  earnings: {
    todayPence: number;
    weekPence: number;
    allTimePence: number;
    jobsToday: number;
  };
  jobs: Array<{
    orderId: string;
    reference: string;
    deliveredAt: string;
    area: string;
    earnedPence: number;
    paid: boolean;
  }>;
  payouts: Array<{
    reference: string;
    earnedPence: number;
    coolBagWithheldPence: number;
    recoveryWithheldPence?: number;
    transferredPence: number;
    at: string;
  }>;
  totalTransferredPence: number;
  /** Paid back for the shopping bought with their own card (ruling 55). */
  paidBack?: Array<{
    reference: string;
    pence: number;
    status: 'paid' | 'waiting' | 'owed';
    at: string;
  }>;
  paidBackTotalPence?: number;
  /** Owed after a decision against them: every one, its reason, and what is left. */
  owing?: Array<{
    reference: string;
    amountPence: number;
    recoveredPence: number;
    remainingPence: number;
    reason: string;
  }>;
  recoveryPercentOfPay?: number;
  /** How often Stripe sends their money on to their bank (ruling 16). */
  payoutSchedule?: 'weekly' | 'daily';
  /** Their motor insurance, when it is soon to run out or has (ruling 14). */
  insurance?: { until: string; daysLeft: number; paused: boolean; words: string } | null;
  /** When they closed their Runner account, or were removed. */
  leftAt?: string | null;
}

export function fetchRunnerDashboard(): Promise<RunnerDashboard> {
  return request<RunnerDashboard>('/runners/me/dashboard', undefined, 'runner');
}

export function sendRunnerFeedback(
  message: string,
  anonymous: boolean,
): Promise<{ message: string }> {
  return request<{ message: string }>(
    '/runners/me/feedback',
    { method: 'POST', body: JSON.stringify({ message, anonymous }) },
    'runner',
  );
}

export function fetchRunnerMe(): Promise<{ runner: RunnerAccount }> {
  return request<{ runner: RunnerAccount }>('/me', undefined, 'runner');
}

export function setRunnerAvailability(available: boolean): Promise<{ runner: RunnerAccount }> {
  return request<{ runner: RunnerAccount }>(
    '/runners/me/availability',
    { method: 'POST', body: JSON.stringify({ available }) },
    'runner',
  );
}

/** Where the Runner's phone says they are, while on shift or on a job (30 October 2026). */
export function shareRunnerLocation(where: {
  latitude: number;
  longitude: number;
}): Promise<{ kept: boolean }> {
  return request<{ kept: boolean }>(
    '/runners/me/location',
    { method: 'POST', body: JSON.stringify(where) },
    'runner',
  );
}

/** The Runner's home postcode, which gives their area: they are offered jobs only there. */
export function saveHomePostcode(
  postcode: string,
): Promise<{ homePostcode: string; area: string | null; message: string }> {
  return request<{ homePostcode: string; area: string | null; message: string }>(
    '/runners/me/home-postcode',
    { method: 'PUT', body: JSON.stringify({ postcode }) },
    'runner',
  );
}

/**
 * A postcode's area (Anthony, 30 October 2026). Every area is open: nothing here ever refuses an
 * order. `warn` is true where there is no approved Runner yet, or the area is paused, and the
 * confirmation screen then warns gently as the order is placed, and only then.
 */
export interface AreaCheck {
  area: string;
  name: string;
  hasRunner: boolean;
  paused: boolean;
  warn: boolean;
  /** "Yes, we deliver in …", for anybody who asks. */
  words: string;
  /** The warning's words, when `warn`. */
  warning?: string;
}

export function checkArea(postcode: string): Promise<AreaCheck> {
  return request<AreaCheck>(`/areas/check?${new URLSearchParams({ postcode }).toString()}`);
}

/** The signed-in Shopper's home area, or the area of the postcode given. */
export function fetchMyArea(postcode?: string): Promise<AreaCheck | { area: null; warn: false }> {
  return request(`/me/area${postcode ? `?${new URLSearchParams({ postcode }).toString()}` : ''}`);
}

/** The warning was shown as they ordered: texted once when a Runner joins there. */
export function markAreaWarned(address: string): Promise<{ noted: boolean }> {
  return request('/me/area/warned', { method: 'POST', body: JSON.stringify({ address }) });
}

export interface RunnerPay {
  setup: 'not_started' | 'incomplete' | 'ready';
  totalEarnedPence: number;
  owedPence: number;
  owedDeliveries: number;
  completedDeliveryCount: number;
}

export function fetchMyPay(): Promise<RunnerPay> {
  return request<RunnerPay>('/runners/me/payouts', undefined, 'runner');
}

/** A one-time link to Stripe's own form, where the Runner's bank details go. */
export function startPaySetup(): Promise<{ url: string }> {
  return request<{ url: string }>('/runners/me/payouts/setup', { method: 'POST' }, 'runner');
}

/**
 * A part of a split job (ruling 60): which part, its pay in words, and that another Runner brings
 * the rest. Never who.
 */
export interface SplitJob {
  part: number;
  of: number;
  /** "Split job — part 1 of 2". */
  label: string;
  /** "Split job — you earn £2.50". */
  earnWords: string;
  rest: string;
}

export interface OfferedJob {
  offer: { id: string };
  secondsLeft: number;
  /** Chained from the door of the job in hand (ruling 64): the next job, near where they are. */
  chained?: boolean;
  chainedWords?: string | null;
  /** Sent straight to them by the office (ruling 80): held for them alone, longer. */
  allocated?: boolean;
  allocatedWords?: string | null;
  job: {
    itemCount: number;
    goodsEstimatePence: number;
    runnerPaymentPence: number;
    distanceMiles: number | null;
    /** The Shop Partners whose things are in it, by name; empty for the shops on the list. */
    shopNames?: string[];
    split?: SplitJob | null;
  } | null;
}

export function fetchOfferedJobs(): Promise<{ offers: OfferedJob[] }> {
  return request<{ offers: OfferedJob[] }>('/jobs/mine', undefined, 'runner');
}

/**
 * A Runner's own place in the fair queue (ruling 64), in one spoken sentence: "You are second in
 * line for the next job." Nothing about anybody else, and no money.
 */
export interface QueuePosition {
  /** 0 is first. Null when they are not in line. */
  position: number | null;
  reason: 'off_shift' | 'job_in_hand' | 'checks_not_done' | 'not_allowed' | null;
  words: string;
}

export function fetchQueuePosition(): Promise<QueuePosition> {
  return request<QueuePosition>('/runners/me/queue-position', undefined, 'runner');
}

/** What taking a job says about paying at the till: the card loaded, or their own card. */
export interface AcceptedJob {
  till?: { payMethodUsed: 'card' | 'own'; cardLimitPence: number | null; message: string };
}

export function acceptJob(offerId: string): Promise<AcceptedJob> {
  return request(`/jobs/${encodeURIComponent(offerId)}/accept`, { method: 'POST' }, 'runner');
}

export function declineJob(offerId: string): Promise<unknown> {
  return request(`/jobs/${encodeURIComponent(offerId)}/decline`, { method: 'POST' }, 'runner');
}

export interface CurrentJob {
  orderId: string;
  status: 'accepted' | 'shopping' | 'receipt_submitted' | 'delivering';
  shopperName: string;
  deliveryAddress: string;
  doorstepProtocol: string;
  substitutionDefault: SubstitutionChoice;
  /** What to pay at the till: for a restaurant with an agreed discount, the counter price. */
  goodsEstimatePence: number;
  /** A restaurant order (30 October 2026): what to pay at the counter, in plain words. */
  counterWords?: string | null;
  receiptTotalPence: number | null;
  runnerPaymentPence: number;
  /** Paying them back for the shopping (ruling 55): how much, and where it has got to. */
  reimbursementPence?: number | null;
  reimbursementStatus?: 'paid' | 'waiting' | 'owed' | null;
  /** Paying at the till with the spending card: what it is loaded with, and has spent. */
  payMethodUsed?: 'card' | 'own' | null;
  cardLimitPence?: number | null;
  cardSpentPence?: number | null;
  /** The two words to say at the door (T6). */
  doorWord?: string | null;
  /** A part of a split job (ruling 60). */
  split?: SplitJob | null;
  /** The Shop Partners whose things are in it, by name; empty for the shops on the list. */
  shopNames?: string[];
  items: Array<{ id: string; name: string; quantity: number; estimatedPricePence: number }>;
}

export function fetchCurrentJob(): Promise<{ job: CurrentJob | null }> {
  return request<{ job: CurrentJob | null }>('/jobs/current', undefined, 'runner');
}

export function moveJobOn(
  orderId: string,
  status: 'shopping' | 'delivering' | 'delivered',
): Promise<unknown> {
  return request(
    `/orders/${encodeURIComponent(orderId)}/status`,
    { method: 'POST', body: JSON.stringify({ status }) },
    'runner',
  );
}

/** What the Runner is told about being paid back for the shopping (ruling 55). */
export interface Reimbursement {
  kind: 'paid' | 'waiting' | 'owed';
  pence: number;
  message: string;
}

export function submitTillTotal(
  orderId: string,
  receiptTotalPence: number,
  /** The photo of the receipt, if the Runner took one: optional, but encouraged. */
  photo?: { base64: string; contentType: string },
): Promise<{ message: string; reimbursement?: Reimbursement | null }> {
  return request<{ message: string; reimbursement?: Reimbursement | null }>(
    `/orders/${encodeURIComponent(orderId)}/receipt`,
    {
      method: 'POST',
      body: JSON.stringify({
        receiptTotalPence,
        ...(photo ? { photo: { data: photo.base64, contentType: photo.contentType } } : {}),
      }),
    },
    'runner',
  );
}

/** The photo of the receipt, sent after the till total. A pay-back waiting only for it goes now. */
export function sendReceiptPhoto(
  orderId: string,
  photo: { base64: string; contentType: string },
): Promise<{ message: string; reimbursement?: Reimbursement | null }> {
  return request<{ message: string; reimbursement?: Reimbursement | null }>(
    `/orders/${encodeURIComponent(orderId)}/receipt-photo`,
    {
      method: 'POST',
      body: JSON.stringify({ data: photo.base64, contentType: photo.contentType }),
    },
    'runner',
  );
}

/** "I cannot find this": a question from the Runner, and the Shopper's answer. */
export type ItemAnswer = 'similar' | 'leave_out';

export interface ItemQuestion {
  id: string;
  orderItemId: string;
  itemName: string;
  answer: ItemAnswer | null;
  answeredBy: 'shopper' | 'no_answer' | null;
  secondsLeft: number;
  ifNoAnswer: ItemAnswer;
}

export function fetchJobQuestions(orderId: string): Promise<{ questions: ItemQuestion[] }> {
  return request<{ questions: ItemQuestion[] }>(
    `/orders/${encodeURIComponent(orderId)}/questions`,
    undefined,
    'runner',
  );
}

export function askAboutItem(
  orderId: string,
  orderItemId: string,
): Promise<{ question: ItemQuestion }> {
  return request<{ question: ItemQuestion }>(
    `/orders/${encodeURIComponent(orderId)}/questions`,
    { method: 'POST', body: JSON.stringify({ orderItemId }) },
    'runner',
  );
}

export interface MyOrder {
  id: string;
  status:
    | 'paid'
    | 'offered'
    | 'accepted'
    | 'shopping'
    | 'receipt_submitted'
    | 'delivering'
    | 'delivered'
    | 'completed';
  runnerName: string | null;
  items: Array<{ id: string; name: string; quantity: number }>;
  totalEstimatePence: number;
  deliveredAt: string | null;
  /** The two words the Runner says at the door (T6), once a Runner has it. */
  doorWord?: string | null;
  /** The same, as one sentence Ozi can say. */
  doorWordSentence?: string | null;
  /** About when it arrives (Section G): "about 20 to 30 minutes", and the latest time. */
  eta?: { words: string; byAt: string } | null;
  /** Feedback after delivery (Section O): given yet, and the credit it earns. */
  feedbackGiven?: boolean;
  feedbackCreditPence?: number;
  /** A demo order (ruling 60): nothing charged, no Runner sent. */
  isDemo?: boolean;
  /**
   * An order coming in parts (ruling 60): each part's Runner, door words, items and arrival
   * time. Null for an order coming whole.
   */
  split?: {
    of: number;
    words: string;
    parts: Array<{
      part: number | null;
      of: number | null;
      status: string;
      runnerName: string | null;
      doorWord: string | null;
      doorWordSentence: string | null;
      eta: { words: string; byAt: string } | null;
      items: Array<{ id: string; name: string; quantity: number }>;
    }>;
  } | null;
}

export function fetchMyOrder(): Promise<{ order: MyOrder | null; questions?: ItemQuestion[] }> {
  return request<{ order: MyOrder | null; questions?: ItemQuestion[] }>('/orders/current');
}

export function answerQuestion(
  orderId: string,
  questionId: string,
  answer: ItemAnswer,
): Promise<{ message: string }> {
  return request<{ message: string }>(
    `/orders/${encodeURIComponent(orderId)}/questions/${encodeURIComponent(questionId)}/answer`,
    { method: 'POST', body: JSON.stringify({ answer }) },
  );
}

/** Who the stored token belongs to. Used to restore a session when the app opens. */
export function fetchMe(): Promise<{ role: string; shopper?: Shopper }> {
  return request<{ role: string; shopper?: Shopper }>('/me');
}

/**
 * Changing the account. The home address can be given this way only the first time; after
 * that, changing it needs the PIN (`changeHomeAddress`).
 */
export function updateMe(
  patch: Partial<RegisterShopperInput> & { ageBand?: Shopper['ageBand'] },
): Promise<{ shopper: Shopper }> {
  return request<{ shopper: Shopper }>('/me', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/* ------------------------------------------------------------------------------------- *
 * Addresses and the PIN (docs/BUILD_PROMPT.md, Section D)
 * ------------------------------------------------------------------------------------- */

export interface SavedAddress {
  id: string;
  label: string;
  address: string;
}

export interface AddressBook {
  home: string;
  saved: SavedAddress[];
  hasPin: boolean;
}

export function fetchAddresses(): Promise<AddressBook> {
  return request<AddressBook>('/me/addresses');
}

/** Choosing the PIN, the first time one is needed. It cannot be chosen twice. */
export function choosePin(pin: string): Promise<{ message: string }> {
  return request<{ message: string }>('/me/pin', {
    method: 'POST',
    body: JSON.stringify({ pin }),
  });
}

/** Change the PIN, knowing the current one (ruling 81). Neither is ever kept here. */
export function changePin(current: string, pin: string): Promise<{ message: string }> {
  return request<{ message: string }>('/me/pin/change', {
    method: 'POST',
    body: JSON.stringify({ current, pin }),
  });
}

export function saveAddress(input: {
  address: string;
  label?: string;
  pin: string;
}): Promise<{ address: SavedAddress }> {
  return request<{ address: SavedAddress }>('/me/addresses', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function removeAddress(id: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/me/addresses/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function changeHomeAddress(
  address: string,
  pin: string,
): Promise<{ home: string; message: string }> {
  return request<{ home: string; message: string }>('/me/home-address', {
    method: 'PUT',
    body: JSON.stringify({ address, pin }),
  });
}

/** The server asked for a PIN to be chosen before it would go on. */
export function pinNeeded(failure: unknown): boolean {
  return failure instanceof ApiError && failure.details?.['pin'] === 'needed';
}

/* ------------------------------------------------------------------------------------- *
 * What the server will tell anybody
 * ------------------------------------------------------------------------------------- */

export interface PublicPaymentsConfig {
  /** `rehearsal` means no card can be charged, and the screens must say so. */
  mode: 'stripe' | 'rehearsal';
  /** Public by design. Null when nobody has configured one. */
  publishableKey: string | null;
  supportedCardRegions: string[];
}

/** The key a browser needs to allow notifications, or null when they are not switched on. */
export function fetchPushPublicKey(): Promise<string | null> {
  return request<{ push?: { publicKey: string | null } }>('/config').then(
    (body) => body.push?.publicKey ?? null,
  );
}

export function savePushSubscription(subscription: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<{ message: string }> {
  return request<{ message: string }>('/push-subscriptions', {
    method: 'POST',
    body: JSON.stringify(subscription),
  });
}

export function removePushSubscription(endpoint: string): Promise<{ message: string }> {
  return request<{ message: string }>('/push-subscriptions', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
  });
}

export function fetchPaymentsConfig(): Promise<PublicPaymentsConfig> {
  return request<{ payments: PublicPaymentsConfig }>('/config').then((body) => body.payments);
}

/* ------------------------------------------------------------------------------------- *
 * Saved cards
 * ------------------------------------------------------------------------------------- */

export interface PaymentMethod {
  id: string;
  lastFour: string;
  brand: string | null;
  isDefault: boolean;
}

/**
 * Rule Ten. Read the arguments: an identifier Stripe gave the browser, and four digits.
 * There is no card number here because no card number ever comes near our server — the
 * details went from the Shopper's browser straight to Stripe.
 */
export function savePaymentMethod(input: {
  stripePaymentMethodId: string;
  lastFour: string;
  brand?: string;
  region?: string;
}): Promise<{ paymentMethod: PaymentMethod; message: string }> {
  return request<{ paymentMethod: PaymentMethod; message: string }>('/payment-methods', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listPaymentMethods(): Promise<{ paymentMethods: PaymentMethod[] }> {
  return request<{ paymentMethods: PaymentMethod[] }>('/payment-methods');
}

/* ------------------------------------------------------------------------------------- *
 * Orders
 * ------------------------------------------------------------------------------------- */

export interface PlacedOrder {
  id: string;
  status: string;
  totalEstimatePence: number;
  feePence: number;
  goodsEstimatePence: number;
  /** Gift card money given straight back to the card once it was paid. */
  creditAppliedPence?: number;
}

export interface CreateOrderResult {
  order: PlacedOrder;
  /** Ozi Family and Carer: over the payer's limit, so nothing is taken until they approve. */
  waitingForApproval?: boolean;
  /** Absent for a bank transfer, which takes nothing from a card. */
  payment?: {
    id: string;
    status: string;
    clientSecret: string | null;
    requiresAction: boolean;
  };
  /** For a bank transfer: where to pay, and the reference to put on it (ruling 50). */
  bank?: {
    accountName: string;
    sortCode: string;
    accountNumber: string;
    reference: string;
    amountPence: number;
    payWithinHours: number;
    /** Booked for a later day (ruling 78): the transfer must arrive by this day. */
    payByDay?: string;
  };
  /** Booked, with the money taken on a chosen day (ruling 78): nothing is taken yet. */
  scheduled?: boolean;
  message: string;
}

/** Ordering now for a later day (ruling 78): the day, the window, and when the money is taken. */
export interface OrderSchedule {
  deliveryDay: string;
  window: 'morning' | 'afternoon' | 'evening';
  pay: 'now' | 'scheduled' | 'bank';
  chargeDay?: string;
  chargeTime?: string;
}

/**
 * Sending the order.
 *
 * `confirmation` is Rule One on the wire. `statement` is the exact sentence the Shopper was
 * shown next to the button, and `agreedTotalPence` is the figure they were shown at that
 * moment. The server prices the basket again from its own catalogue and refuses the order if
 * the total has moved, rather than charging a different amount from the one that was agreed.
 * That refusal arrives as an ordinary error with the new price in the message.
 */
export function createOrder(input: {
  lines: Array<{ catalogueItemId: string; quantity: number }>;
  deliveryAddress: string;
  /** The saved card; not needed when paying by bank transfer. */
  paymentMethodId?: string;
  /** A card through Stripe, or a bank transfer to the business account (ruling 50). */
  payBy?: 'card' | 'bank' | 'family';
  /** Ruling 61: a basket over £150 kept whole, as linked orders each with its own Runner. */
  keepEverything?: boolean;
  /** Booked for a later day (ruling 78); left out, as soon as possible. */
  schedule?: OrderSchedule;
  confirmation: {
    statement: string;
    agreedTotalPence: number;
    /** How the Shopper said yes: a press of the button, or out loud to Ozi. */
    channel?: 'button' | 'voice';
    /** The delivery address was put to the Shopper and they said yes to it (Section D). */
    addressConfirmed: true;
  };
}): Promise<CreateOrderResult> {
  return request<CreateOrderResult>('/orders', {
    method: 'POST',
    body: JSON.stringify({
      lines: input.lines,
      deliveryAddress: input.deliveryAddress,
      ...(input.paymentMethodId ? { paymentMethodId: input.paymentMethodId } : {}),
      payBy: input.payBy ?? 'card',
      ...(input.keepEverything ? { keepEverything: true } : {}),
      ...(input.schedule ? { schedule: input.schedule } : {}),
      confirmation: {
        confirmed: true,
        addressConfirmed: input.confirmation.addressConfirmed,
        channel: input.confirmation.channel ?? 'button',
        statement: input.confirmation.statement,
        agreedTotalPence: input.confirmation.agreedTotalPence,
      },
    }),
  });
}

/* ------------------------------------------------------------------------------------- *
 * When something goes wrong with an order
 * ------------------------------------------------------------------------------------- */

export interface ProblemReport {
  id: string;
  orderId: string;
  reportedBy: 'runner' | 'shopper';
  summary: string;
  refundRequestedPence: number;
  status: 'open' | 'decided';
  decideBy: string;
  decision: string | null;
  decisionWords: string | null;
  refundPence: number;
  decisionNote: string | null;
  decidedAt: string | null;
  evidence: Array<{
    id: string;
    kind: 'voice_note' | 'photo' | 'note';
    addedBy: 'runner' | 'shopper';
    text: string | null;
    createdAt: string;
  }>;
}

export function fetchProblems(
  orderId: string,
  as: 'shopper' | 'runner',
): Promise<{ reports: ProblemReport[] }> {
  return request<{ reports: ProblemReport[] }>(
    `/orders/${encodeURIComponent(orderId)}/problems`,
    undefined,
    as,
  );
}

export function reportProblem(
  orderId: string,
  input: { summary: string; refundRequestedPence?: number },
  as: 'shopper' | 'runner',
): Promise<{ report: ProblemReport; message: string }> {
  return request<{ report: ProblemReport; message: string }>(
    `/orders/${encodeURIComponent(orderId)}/problems`,
    { method: 'POST', body: JSON.stringify(input) },
    as,
  );
}

export function addProblemEvidence(
  reportId: string,
  input: {
    kind: 'voice_note' | 'photo' | 'note';
    data?: string;
    contentType?: string;
    text?: string;
  },
  as: 'shopper' | 'runner',
): Promise<{ message: string }> {
  return request<{ message: string }>(
    `/problems/${encodeURIComponent(reportId)}/evidence`,
    { method: 'POST', body: JSON.stringify(input) },
    as,
  );
}

export interface PastOrder {
  id: string;
  status: string;
  totalEstimatePence: number;
  finalTotalPence: number | null;
  createdAt: string;
  deliveredAt: string | null;
  items: Array<{ id: string; name: string; quantity: number; catalogueItemId?: string | null }>;
}

/** Ozi Recipes: unlock it for the agreed price, taken from the saved card. */
export function buyRecipePass(): Promise<{ recipePassUntil: string; message: string }> {
  return request<{ recipePassUntil: string; message: string }>('/extras/recipe-pass', {
    method: 'POST',
    body: JSON.stringify({ priceAccepted: true }),
  });
}

/** Every order the signed-in Shopper has made, newest first. */
export function fetchMyOrders(): Promise<{ orders: PastOrder[] }> {
  return request<{ orders: PastOrder[] }>('/orders');
}

/* ------------------------------------------------------------------------------------- *
 * In-app calls (Section F)
 * ------------------------------------------------------------------------------------- */

export interface CallsConfig {
  enabled: boolean;
  pencePerMinute: number;
}

/** Whether paying by bank transfer is switched on (ruling 50). */
export function fetchBankTransferEnabled(): Promise<boolean> {
  return request<{ bankTransfer?: { enabled?: boolean } }>('/config').then(
    (body) => body.bankTransfer?.enabled === true,
  );
}

export function fetchCallsConfig(): Promise<CallsConfig> {
  return request<{ calls?: CallsConfig }>('/config').then(
    (body) => body.calls ?? { enabled: false, pencePerMinute: 5 },
  );
}

/** A pass to Oluoma Voice (ruling 53): where it runs, and a token that lasts five minutes. */
export interface VoiceSession {
  url: string;
  token: string;
  /** When the token stops working, as an ISO date. */
  expiresAt: string;
}

/**
 * A fresh pass to Oluoma Voice, or null when the server has none to give: not set up, or the
 * engine did not answer. The engine's key is never sent here; only the server holds it.
 */
export function fetchVoiceSession(): Promise<VoiceSession | null> {
  return request<{ enabled?: boolean } & Partial<VoiceSession>>('/voice/session').then((body) =>
    body.enabled === true && body.url && body.token && body.expiresAt
      ? { url: body.url, token: body.token, expiresAt: body.expiresAt }
      : null,
  );
}

export interface CallInfo {
  id: string;
  orderId: string;
  status: 'ringing' | 'live' | 'ended';
  startedBy: 'shopper' | 'runner';
  pencePerMinute: number;
  priceAccepted: boolean;
}

export interface CallJoin {
  url: string;
  token: string;
  roomName: string;
}

export function fetchCurrentCall(
  orderId: string,
  as: 'shopper' | 'runner',
): Promise<{ call: CallInfo | null }> {
  return request<{ call: CallInfo | null }>(
    `/orders/${encodeURIComponent(orderId)}/calls/current`,
    undefined,
    as,
  );
}

export function startCall(
  orderId: string,
  as: 'shopper' | 'runner',
): Promise<{ call: CallInfo; join: CallJoin }> {
  return request<{ call: CallInfo; join: CallJoin }>(
    `/orders/${encodeURIComponent(orderId)}/calls`,
    { method: 'POST', body: JSON.stringify(as === 'shopper' ? { priceAccepted: true } : {}) },
    as,
  );
}

export function answerCall(
  callId: string,
  as: 'shopper' | 'runner',
): Promise<{ call: CallInfo; join: CallJoin }> {
  return request<{ call: CallInfo; join: CallJoin }>(
    `/calls/${encodeURIComponent(callId)}/join`,
    { method: 'POST', body: JSON.stringify(as === 'shopper' ? { priceAccepted: true } : {}) },
    as,
  );
}

export function endCall(callId: string, as: 'shopper' | 'runner'): Promise<unknown> {
  return request<unknown>(`/calls/${encodeURIComponent(callId)}/end`, { method: 'POST' }, as);
}

/** The Runner rings the Shopper's own telephone into the call; the number is never shown. */
export function ringShopperPhone(callId: string): Promise<{ ringing: true; message: string }> {
  return request(`/calls/${encodeURIComponent(callId)}/phone`, { method: 'POST' }, 'runner');
}

export function addCallGuest(
  callId: string,
  name: string,
): Promise<{ link: string; message: string }> {
  return request<{ link: string; message: string }>(`/calls/${encodeURIComponent(callId)}/guests`, {
    method: 'POST',
    body: JSON.stringify({ name, priceAccepted: true }),
  });
}

export function joinAsGuest(code: string): Promise<{ name: string; join: CallJoin }> {
  return request<{ name: string; join: CallJoin }>('/calls/guest-join', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

/* ------------------------------------------------------------------------------------- *
 * The admin panel (/staff): every call carries the staff key in an x-staff-key header
 * ------------------------------------------------------------------------------------- */

/**
 * What proves who is signed in: a staff account's session token (it starts "st1."), or the
 * founder's staff key, each sent in its own header.
 */
function staffHeaders(key: string): Record<string, string> {
  return key.startsWith('st1.') ? { 'x-staff-token': key } : { 'x-staff-key': key };
}

export function staffRequest<T>(key: string, path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, { ...init, headers: staffHeaders(key) });
}

export function checkStaffKey(key: string): Promise<{ ok: true }> {
  return staffRequest(key, '/staff/check');
}

/** What each staff job is, and which parts of the panel it sees. */
export type StaffArea =
  | 'documents'
  | 'problems'
  | 'feedback'
  | 'owed'
  | 'finds'
  | 'enquiries'
  | 'partners'
  | 'analytics'
  | 'overview'
  | 'money'
  | 'team'
  | 'learning'
  | 'payments'
  | 'orders'
  | 'runners'
  | 'reports'
  | 'accounts'
  | 'audit'
  /** The company inbox and staff calls (ruling 77). */
  | 'messages'
  /** Each UK area, whether it is running, and pausing it (30 October 2026). */
  | 'areas'
  | 'referrals'
  /** Checkout insights: why people do not pay (30 October 2026). */
  | 'insights'
  /** Ozi Ambassador applications (30 October 2026). */
  | 'ambassadors';

/** Where someone's two-step codes stand (Section Q). */
export interface StaffTwoStep {
  on: boolean;
  /** When they become a must. */
  dueAt: string;
  /** Past the grace period and not set up: nothing else opens until they are. */
  setupNeeded: boolean;
  recoveryCodesLeft: number;
}

export interface StaffSignedIn {
  token: string;
  name: string;
  role: string;
  title: string;
  areas: StaffArea[];
  mustChangePassword: boolean;
  twoStep?: StaffTwoStep;
  /** Said when a recovery code was used. */
  message?: string;
}

export function staffSignIn(
  username: string,
  password: string,
  extra: { passcode?: string; code?: string } = {},
): Promise<StaffSignedIn> {
  return request('/staff/sign-in', {
    method: 'POST',
    body: JSON.stringify({ username, password, ...extra }),
  });
}

export function fetchStaffMe(key: string): Promise<
  Omit<StaffSignedIn, 'token'> & {
    account: boolean;
    isOwner?: boolean;
    /** How Ozi addresses the owner, such as "Mr Anthony"; null for everyone else. */
    address?: string | null;
    viewOnly?: boolean;
    totpEnabled?: boolean;
    /** Null for the staff key, which has no account. */
    twoStep?: StaffTwoStep | null;
    /** May send orders straight to a chosen Runner (ruling 80). */
    canAllocate?: boolean;
    /** May unlock anybody, and reset a PIN or a password (ruling 81). */
    canUnlock?: boolean;
  }
> {
  return staffRequest(key, '/staff/me');
}

export function changeStaffPassword(
  key: string,
  current: string,
  password: string,
): Promise<{ message: string }> {
  return staffRequest(key, '/staff/password', {
    method: 'POST',
    body: JSON.stringify({ current, password }),
  });
}

export interface StaffRoleInfo {
  role: string;
  title: string;
  areas: StaffArea[];
}

export function fetchStaffRoles(): Promise<{ roles: StaffRoleInfo[] }> {
  return request('/staff/roles');
}

export interface TeamMember {
  id: string;
  name: string;
  username: string;
  role: string;
  title: string;
  active: boolean;
  mustChangePassword: boolean;
  lastSignInAt: string | null;
  createdAt: string;
  twoStepOn?: boolean;
  /** May issue message and call codes, and message and call without one (ruling 77). */
  canAuthorise?: boolean;
  /** May send orders straight to a chosen Runner, outside the queue (ruling 80). */
  canAllocate?: boolean;
  /** May unlock anybody, and reset a PIN or a password (ruling 81). */
  canUnlock?: boolean;
  /** Locked out of signing in, or of message and call codes, right now (ruling 81). */
  lockedOut?: boolean;
  isOwner?: boolean;
}

export function fetchTeam(key: string): Promise<{ team: TeamMember[] }> {
  return staffRequest(key, '/staff/team');
}

export function addTeamMember(
  key: string,
  input: { name: string; username: string; role: string },
): Promise<{ member: TeamMember; password: string; message: string }> {
  return staffRequest(key, '/staff/team', { method: 'POST', body: JSON.stringify(input) });
}

export function updateTeamMember(
  key: string,
  id: string,
  patch: { role?: string; active?: boolean },
): Promise<{ member: TeamMember }> {
  return staffRequest(key, `/staff/team/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify(patch),
  });
}

export function resetTeamPassword(
  key: string,
  id: string,
): Promise<{ password: string; message: string }> {
  return staffRequest(key, `/staff/team/${encodeURIComponent(id)}/reset`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export interface StaffDocument {
  id: string;
  kind: string;
  name: string;
  status: string;
  sentAs: 'share code' | 'photo' | 'PDF';
  shareCode: string | null;
  createdAt: string;
  runner: { id: string; name: string; runnerId: string } | null;
}

export function fetchStaffDocuments(key: string): Promise<{ documents: StaffDocument[] }> {
  return staffRequest(key, '/staff/documents');
}

export function reviewDocument(
  key: string,
  id: string,
  review: { decision: 'accept' | 'reject'; by: string; note?: string; expiresOn?: string },
): Promise<unknown> {
  return staffRequest(key, `/staff/documents/${encodeURIComponent(id)}/review`, {
    method: 'POST',
    body: JSON.stringify(review),
  });
}

export interface StaffProblem {
  id: string;
  orderId: string;
  reportedBy: 'runner' | 'shopper';
  /** Who sent it, by name, when known. */
  reporterName?: string | null;
  summary: string;
  refundRequestedPence: number | null;
  decideBy: string;
  overdue: boolean;
  evidence: Array<{
    id: string;
    kind: 'voice_note' | 'photo' | 'note';
    addedBy: 'runner' | 'shopper';
    text: string | null;
    contentType: string | null;
  }>;
  /** The order itself: its items, Runner and totals, so the decision is made on the whole. */
  order?: {
    reference: string;
    status: string;
    runnerName: string | null;
    items: Array<{ name: string; quantity: number; outcome: string }>;
    goodsEstimatePence: number;
    feePence: number;
    totalEstimatePence: number;
    receiptTotalPence: number | null;
    finalTotalPence: number | null;
    paidBy: 'card' | 'bank';
  } | null;
}

export function fetchStaffProblems(key: string): Promise<{ reports: StaffProblem[] }> {
  return staffRequest(key, '/staff/problems');
}

export type ProblemDecision =
  'shopper_at_fault' | 'runner_at_fault' | 'platform_at_fault' | 'shop_at_fault' | 'no_fault';

export function decideProblem(
  key: string,
  id: string,
  decision: { decision: ProblemDecision; refundPence: number; note: string; by: string },
): Promise<unknown> {
  return staffRequest(key, `/staff/problems/${encodeURIComponent(id)}/decide`, {
    method: 'POST',
    body: JSON.stringify(decision),
  });
}

export interface StaffFeedback {
  id: string;
  message: string;
  createdAt: string;
  runner: { name: string; runnerId: string } | null;
}

export function fetchStaffFeedback(key: string): Promise<{ feedback: StaffFeedback[] }> {
  return staffRequest(key, '/staff/feedback');
}

export interface StaffRecovery {
  runner: { id: string; name: string; runnerId?: string };
  remainingPence: number;
  canWriteOff: boolean;
}

export function fetchStaffRecoveries(
  key: string,
): Promise<{ recoveries: StaffRecovery[]; writeOffUpToPence: number }> {
  return staffRequest(key, '/staff/recoveries');
}

export function writeOffRunner(
  key: string,
  runnerId: string,
  by: string,
): Promise<{ message: string }> {
  return staffRequest(key, `/staff/runners/${encodeURIComponent(runnerId)}/write-off`, {
    method: 'POST',
    body: JSON.stringify({ by }),
  });
}

/** A document photo or a piece of evidence, as a local address the page can show or play. */
export async function fetchStaffFile(key: string, path: string): Promise<string> {
  const response = await fetch(`${BASE_URL}${path}`, { headers: staffHeaders(key) });
  if (!response.ok)
    throw new ApiError('That file could not be opened.', response.status, undefined);
  return URL.createObjectURL(await response.blob());
}

/* ------------------------------------------------------------------------------------- *
 * More from Ozi (7 October 2026): Ozi Plus and the family plan, Ozi Finds It, gift cards,
 * weekly shop day, and organisations asking to work with us. Every price agreed first.
 * ------------------------------------------------------------------------------------- */

export type PlanName = 'membership' | 'plus' | 'family';

export interface PlusState {
  plan: PlanName | null;
  planName: string | null;
  planUntil: string | null;
  renews: boolean;
  cancelled: boolean;
  monthlyPence: number | null;
  freeMonthUntil: string | null;
  deliveryPlan: import('@aldilivery/core').DeliveryPlan;
  familyCode: string | null;
  members: Array<{ id: string; name: string }>;
  joinedFamilyOf: string | null;
  approvalLimitPence: number | null;
  familyMaximum: number;
  creditPence: number;
}

export function fetchPlus(): Promise<PlusState> {
  return request<PlusState>('/plans');
}

/**
 * Joining a plan: the monthly price agreed, and that it is taken each month until cancelled
 * (ruling 58). The screen asks both in plain words before this is sent.
 */
export function buyPlus(plan: PlanName): Promise<PlusState & { message: string }> {
  return request('/plans/join', {
    method: 'POST',
    body: JSON.stringify({ plan, priceAccepted: true, monthlyAccepted: true }),
  });
}

/** One button: nothing more is taken; the plan runs to the end of the month paid for. */
export function cancelPlan(): Promise<PlusState & { message: string }> {
  return request('/plans/cancel', { method: 'POST', body: JSON.stringify({}) });
}

export function setApprovalLimit(
  limitPence: number | null,
): Promise<PlusState & { message: string }> {
  return request('/extras/family/approval-limit', {
    method: 'POST',
    body: JSON.stringify({ limitPence }),
  });
}

export interface FamilyOrder {
  id: string;
  person: string;
  status: string;
  approvalStatus: 'waiting' | 'approved' | 'declined' | null;
  totalPence: number;
  items: number;
  createdAt: string;
}

export function fetchFamilyOrders(): Promise<{
  orders: FamilyOrder[];
  approvalLimitPence: number | null;
}> {
  return request('/plans/family/orders');
}

export function decideFamilyOrder(id: string, approve: boolean): Promise<{ message?: string }> {
  return request(
    `/plans/family/orders/${encodeURIComponent(id)}/${approve ? 'approve' : 'decline'}`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  );
}

export function joinFamily(code: string): Promise<PlusState & { message: string }> {
  return request('/extras/family/join', { method: 'POST', body: JSON.stringify({ code }) });
}

export function leaveFamily(): Promise<PlusState & { message: string }> {
  return request('/extras/family/leave', { method: 'POST', body: JSON.stringify({}) });
}

export interface FindRequest {
  id: string;
  description: string;
  feePence: number;
  status: 'looking' | 'found' | 'not_found';
  foundName: string | null;
  foundShop: string | null;
  foundPricePence: number | null;
  catalogueItemId: string | null;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export function fetchFindRequests(): Promise<{ requests: FindRequest[] }> {
  return request('/extras/find-it');
}

export function askToFind(description: string): Promise<{ request: FindRequest; message: string }> {
  return request('/extras/find-it', {
    method: 'POST',
    body: JSON.stringify({ description, priceAccepted: true }),
  });
}

export function fetchCatalogueItem(
  id: string,
): Promise<{ found: boolean; item: CatalogueItem | null }> {
  return request(`/catalogue/${encodeURIComponent(id)}`);
}

export interface GiftCardBought {
  code: string;
  amountPence: number;
  recipientName: string;
  message: string;
  used: boolean;
  createdAt: string;
}

export function fetchGiftCards(): Promise<{
  amountsPence: number[];
  creditPence: number;
  bought: GiftCardBought[];
}> {
  return request('/extras/gift-cards');
}

export function buyGiftCard(input: {
  amountPence: number;
  recipientName: string;
  message: string;
}): Promise<{ giftCard: GiftCardBought; message: string }> {
  return request('/extras/gift-cards', {
    method: 'POST',
    body: JSON.stringify({ ...input, priceAccepted: true }),
  });
}

export function redeemGiftCard(code: string): Promise<{ creditPence: number; message: string }> {
  return request('/extras/gift-cards/redeem', { method: 'POST', body: JSON.stringify({ code }) });
}

export interface WeeklyShop {
  id: string;
  name: string;
  dayOfWeek: number;
  active: boolean;
  items: Array<{ catalogueItemId: string | null; name: string; quantity: number }>;
  /** Set when the Shopper agreed it is sent and paid for by itself after the notice. */
  autoSendAgreedAt?: string | null;
  nextFireAt?: string;
  /** When the thirty-minute notice for the next one went, if it has. */
  noticeSentAt?: string | null;
  skipRequestedForFireAt?: string | null;
}

export function fetchWeeklyShops(): Promise<{ sets: WeeklyShop[] }> {
  return request('/sets');
}

export function bookWeeklyShop(input: {
  dayOfWeek: number;
  deliveryAddress: string;
  lines: Array<{ catalogueItemId: string; quantity: number }>;
  /** Sent and paid for by itself with this saved card, after the notice (Rule One: agreed here). */
  paymentMethodId?: string;
  autoSend?: { confirmed: true; statement: string };
}): Promise<{ set: WeeklyShop }> {
  return request('/sets', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Weekly shop',
      frequency: 'weekly',
      timeOfDay: '10:00',
      ...input,
    }),
  });
}

export function stopWeeklyShop(id: string): Promise<unknown> {
  return request(`/sets/${encodeURIComponent(id)}/pause`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function sendOrganisationEnquiry(input: {
  /** A shop asking from /organisations?shop=1, or an organisation (30 October 2026). */
  kind?: 'organisation' | 'shop';
  organisation: string;
  contactName: string;
  telephone: string;
  email: string;
  people: string;
  message: string;
  /** The Organisation terms at /organisation/terms, ticked: needed from an organisation. */
  termsAgreed?: boolean;
}): Promise<{ message: string }> {
  // The referral link that brought them, kept until staff set the organisation up (30 October 2026).
  const via = joinedVia();
  return request<{ message: string }>('/organisations/enquiries', {
    method: 'POST',
    body: JSON.stringify(via ? { ...input, joinedVia: via } : input),
  }).then((sent) => {
    forgetJoinedVia();
    return sent;
  });
}

export interface StaffFindRequest extends FindRequest {
  shopperName: string;
  area: string;
}

export function fetchStaffFinds(
  key: string,
): Promise<{ requests: StaffFindRequest[]; shops: number }> {
  return staffRequest(key, '/staff/find-it');
}

export function decideFind(
  key: string,
  id: string,
  decision:
    | { found: true; name: string; shop: string; pricePence: number; note?: string }
    | { found: false; note?: string },
): Promise<unknown> {
  return staffRequest(key, `/staff/find-it/${encodeURIComponent(id)}/decide`, {
    method: 'POST',
    body: JSON.stringify(decision),
  });
}

export interface StaffEnquiry {
  id: string;
  organisation: string;
  contactName: string;
  telephone: string;
  email: string;
  people: string;
  message: string;
  handled: boolean;
  createdAt: string;
}

export function fetchStaffEnquiries(key: string): Promise<{ enquiries: StaffEnquiry[] }> {
  return staffRequest(key, '/staff/enquiries');
}

export function markEnquiryHandled(key: string, id: string): Promise<unknown> {
  return staffRequest(key, `/staff/enquiries/${encodeURIComponent(id)}/handled`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/* ------------------------------------------------------------------------------------- *
 * Partner shops and organisations (7 October 2026): their own sign-in, sent as an
 * x-business-token header, so it can never be mistaken for a Shopper, Runner or staff.
 * ------------------------------------------------------------------------------------- */

const BUSINESS = 'ozidelivery.business.token';

export function businessToken(): string {
  try {
    return window.sessionStorage.getItem(BUSINESS) ?? '';
  } catch {
    return '';
  }
}

export function rememberBusinessToken(token: string | null): void {
  try {
    if (token === null) window.sessionStorage.removeItem(BUSINESS);
    else window.sessionStorage.setItem(BUSINESS, token);
  } catch {
    // Private browsing: they sign in again next time.
  }
}

function businessRequest<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, { ...init, headers: { 'x-business-token': businessToken() } });
}

/** An Ozi Preferred Partner takes its free Spotlight week for this month (30 October 2026). */
export function takeFreeSpotlightWeek(): Promise<{ until: string; message: string }> {
  return businessRequest('/partner/spotlight/free-week', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export interface BusinessMe {
  kind: 'partner' | 'organisation';
  name: string;
  office: string;
  business: string;
  mustChangePassword: boolean;
}

export function businessSignIn(
  username: string,
  password: string,
): Promise<BusinessMe & { token: string }> {
  return request('/business/sign-in', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function fetchBusinessMe(): Promise<BusinessMe> {
  return businessRequest('/business/me');
}

export function changeBusinessPassword(
  current: string,
  password: string,
): Promise<{ message: string }> {
  return businessRequest('/business/password', {
    method: 'POST',
    body: JSON.stringify({ current, password }),
  });
}

export interface PartnerProductRow {
  id: string;
  name: string;
  pricePence: number;
  tags: string;
  expiresOn: string | null;
  hasPhoto: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'removed';
  note: string | null;
  catalogueItemId: string | null;
  createdAt: string;
  /** A service: how long it takes, in minutes. Its price is "from". */
  durationMinutes: number | null;
  /** The barcode it was scanned with, if any (ruling 75). */
  barcode?: string | null;
  /** The label showed no price, so the price is an estimate to check (ruling 75). */
  priceEstimated?: boolean;
}

/** What kind of business a partner is (ruling 65). */
export type PartnerKind = 'shop' | 'food' | 'service';

/** A Shopper's request to a service for a quote or a call back (ruling 65). */
export interface ServiceEnquiryRow {
  id: string;
  kind: 'quote' | 'call_back';
  what: string;
  message: string;
  status: 'open' | 'answered' | 'closed';
  reply: string | null;
  createdAt: string;
  answeredAt: string | null;
  shopName?: string;
  shopperName?: string;
  contact?: string;
}

/**
 * A restaurant, café or takeaway's own figures (Anthony, 30 October 2026): no commission, ever;
 * its agreed discount for Ozi, whether it is a Preferred Partner, and this month's orders.
 */
export interface PartnerRestaurant {
  discountPercent: number;
  /** The agreed mark-up on its prices (30 October 2026). */
  markupPercent?: number;
  preferred: boolean;
  preferredDiscountPercent: number;
  ordersThisMonth: number;
  goodsThisMonthPence: number;
  words: string;
}

export interface PartnerDashboard extends PartnerExtras {
  shop: {
    id: string;
    name: string;
    address: string;
    telephone: string;
    about: string;
    kind: PartnerKind;
    kindWords: string;
    postcode: string;
    hours: string;
    status: 'pending' | 'approved' | 'removed';
    active: boolean;
    listed: boolean;
  } & Partial<BrowseFields>;
  plan: {
    tier: 'free' | 'plus';
    monthlyPence: number;
    plusMonthlyPence: number;
    paidUntil: string | null;
    paid: boolean;
    freeForever: boolean;
    firstMonthFree: boolean;
    productLimit: number | null;
    productsListed: number;
    canAddProduct: boolean;
    words: string;
  };
  restaurant: PartnerRestaurant | null;
  enquiries: ServiceEnquiryRow[];
  counts: { live: number; waiting: number; notAccepted: number };
  products: PartnerProductRow[];
  sharePath: string;
  /**
   * The Shop Partner terms changed since this partner agreed (30 October 2026): until they agree
   * again, every change but agreeing waits. Their listing stays live.
   */
  terms?: { changed: boolean; words: string | null; version: string; path: string };
}

/** "I agree" to the Shop Partner terms of this version (30 October 2026). */
export function agreePartnerTerms(termsVersion: string): Promise<{ message: string }> {
  return businessRequest('/partner/terms/agree', {
    method: 'POST',
    body: JSON.stringify({ termsAgreed: true, termsVersion }),
  });
}

/** What a joining business is told about the tiers, every figure from config/store.json. */
export interface PartnerJoinOptions {
  kinds: Array<{ kind: PartnerKind; words: string }>;
  freeListingsLeft: number;
  freeProductLimit: number;
  plusMonthlyPence: number;
  plusFirstMonthFree: boolean;
  /** Restaurants: the flat restaurant fee and smallest order, in words (30 October 2026). */
  restaurantWords: string;
  preferredDiscountPercent: number;
  spotlightPence: number;
  spotlightPlusPence: number;
  excludedServiceKinds: string[];
  /** Whether the mobile must be confirmed with a code before joining. */
  mobileConfirmed: boolean;
}

export function fetchPartnerJoinOptions(): Promise<PartnerJoinOptions> {
  return request('/partner/join/options');
}

export interface PartnerJoinInput {
  name: string;
  kind: PartnerKind;
  address: string;
  postcode: string;
  hours: string;
  contactName: string;
  mobile: string;
  phoneProof?: string;
  email: string;
  about: string;
  username: string;
  password: string;
  claimShopId?: string;
  plan?: 'free' | 'plus';
  /** Partner Plus paid from today, skipping the free month (ruling 75). */
  payNow?: boolean;
  /** The Shop Partner terms at /partner/terms, ticked (30 October 2026). */
  termsAgreed: boolean;
  cuisines?: string[];
  specialities?: string[];
  categories?: string[];
  convenience?: boolean;
  ofstedNumber?: string;
  /** "Did someone introduce you? Their code (optional)" (30 October 2026). */
  introducedBy?: string;
}

/**
 * What a place is browsed under (ruling 82): its cuisines (a restaurant, café or takeaway), its
 * specialities and whether it is a convenience store (a shop), its categories and a childminder's
 * Ofsted number (a service), each chosen from the lists in `browse` in config/store.json.
 */
export interface BrowseFields {
  cuisines: string[];
  specialities: string[];
  categories: string[];
  convenience: boolean;
  ofstedNumber: string;
}

/** The partner says how Shoppers find it, on the dashboard (ruling 82). */
export function savePartnerProfile(
  input: Partial<BrowseFields> & { about?: string },
): Promise<{ shop: BrowseFields & { about: string }; message: string }> {
  return businessRequest('/partner/profile', { method: 'POST', body: JSON.stringify(input) });
}

/** A shop, café, takeaway or service joins by itself (ruling 65) and is signed in at once. */
export function joinAsPartner(input: PartnerJoinInput): Promise<
  BusinessMe & {
    token: string;
    shop: { id: string; status: string; plan: string; freeForever: boolean };
    /** Paying from today (ruling 75): Stripe's page to go to, and the receipt to keep. */
    checkout?: { url: string; receipt: string } | null;
    message: string;
  }
> {
  // The link that brought them, and the Ozi Ambassador who introduced them, if any (30 October
  // 2026), kept on the device until the business has joined.
  const via = joinedVia();
  const ambassador = ambassadorVia();
  const body = {
    ...input,
    ...(via ? { joinedVia: via } : {}),
    ...(ambassador ? { ambassador } : {}),
  };
  return request<Awaited<ReturnType<typeof joinAsPartner>>>('/partner/join', {
    method: 'POST',
    body: JSON.stringify(body),
  }).then((made) => {
    forgetJoinedVia();
    forgetAmbassador();
    return made;
  });
}

/**
 * The receipt for a Partner Plus Checkout page, kept in this tab until Stripe sends the shop back
 * to the dashboard with `?paid=<session>` (ruling 65; from the join form too, ruling 75).
 */
export const PARTNER_RECEIPT_KEY = 'ozidelivery.partner.receipt';

/** A product the camera found, for the shop to check before "Add all" (ruling 75). */
export interface ScanDraft {
  name: string;
  pricePence: number | null;
  /** The label showed no price: this one is an estimate, "please check". */
  priceEstimated: boolean;
  barcode: string | null;
}

/** A photo of a shelf label or a pack, read by the language model on the server. */
export function scanLabel(
  photo: string,
  photoType: string,
): Promise<{ draft: ScanDraft | null; message: string }> {
  return businessRequest('/partner/scan/label', {
    method: 'POST',
    body: JSON.stringify({ photo, photoType }),
  });
}

/** A barcode the camera saw: its name and an estimated price, when anything knows them. */
export function scanBarcode(barcode: string): Promise<{ draft: ScanDraft }> {
  return businessRequest('/partner/scan/barcode', {
    method: 'POST',
    body: JSON.stringify({ barcode }),
  });
}

/**
 * Paying for Partner Plus, Spotlight or Spotlight Plus from the dashboard: a Stripe Checkout
 * page to go to (`url`), with the signed receipt the dashboard sends back once paid; or, for
 * the free first month, no page at all and the plan simply on.
 */
export function startPartnerCheckout(input: {
  kind?: 'plan' | 'spotlight' | 'plus';
  months?: number;
  returnTo?: string;
}): Promise<{ url: string | null; receipt?: string; message: string }> {
  return businessRequest('/partner/plan/checkout', { method: 'POST', body: JSON.stringify(input) });
}

export function confirmPartnerCheckout(
  receipt: string,
  sessionId: string,
): Promise<{ recorded: boolean; message: string }> {
  return businessRequest('/partner/plan/confirm', {
    method: 'POST',
    body: JSON.stringify({ receipt, sessionId }),
  });
}

export function answerPartnerEnquiry(id: string, reply: string): Promise<{ message: string }> {
  return businessRequest(`/partner/enquiries/${encodeURIComponent(id)}/answer`, {
    method: 'POST',
    body: JSON.stringify({ reply }),
  });
}

/** The Shopper asks a service for a quote or a call back. No payment goes through us. */
export function sendServiceEnquiry(
  shopId: string,
  input: { kind: 'quote' | 'call_back'; productId?: string; message: string; contact: string },
): Promise<{ enquiry: ServiceEnquiryRow; message: string }> {
  return request(`/shops/${encodeURIComponent(shopId)}/enquiry`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function fetchMyEnquiries(): Promise<{ enquiries: ServiceEnquiryRow[] }> {
  return request('/me/enquiries');
}

export function fetchPartnerDashboard(): Promise<PartnerDashboard> {
  return businessRequest('/partner/dashboard');
}

export function addPartnerProduct(input: {
  name: string;
  pricePence: number;
  tags: string;
  expiresOn?: string;
  photo?: string;
  photoType?: string;
  durationMinutes?: number;
  barcode?: string;
  priceEstimated?: boolean;
}): Promise<{ product: PartnerProductRow; message: string }> {
  return businessRequest('/partner/products', { method: 'POST', body: JSON.stringify(input) });
}

export function setPartnerPrice(id: string, pricePence: number): Promise<{ message: string }> {
  return businessRequest(`/partner/products/${encodeURIComponent(id)}/price`, {
    method: 'POST',
    body: JSON.stringify({ pricePence }),
  });
}

export function removePartnerProduct(id: string): Promise<{ message: string }> {
  return businessRequest(`/partner/products/${encodeURIComponent(id)}/remove`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export interface PublicShop {
  id: string;
  name: string;
  about: string;
  kind: PartnerKind;
  kindWords: string;
  /** The first part of the postcode, such as ME7. */
  area: string;
  hours: string;
  listedByOzi: boolean;
  products: number;
  /** Shop of the Month, of the Quarter or of the Half Year, with words (ruling 70). */
  awards?: string[];
  /** On paid Partner Plus: first among shops at the same distance (ruling 75). */
  partnerPlus?: boolean;
  /** An Ozi Preferred Partner (30 October 2026): listed first, with a badge. */
  preferredPartner?: boolean;
  /** "Prices on Ozi may be higher than in the restaurant", where a mark-up applies. */
  priceNote?: string | null;
  /** Which of the four pages it is on (ruling 82). */
  section?: BrowseSection;
  cuisines?: string[];
  specialities?: string[];
  categories?: string[];
  convenience?: boolean;
  /** A childminder's Ofsted registration number, as the provider gave it. Never checked by us. */
  ofstedNumber?: string;
  /** In the Shopper's postcode district (true), further away (false), or no postcode (null). */
  nearYou?: boolean | null;
}

export type BrowseSection = 'restaurants' | 'shops' | 'convenience' | 'services';

/** What a browse page asks for (ruling 82): one section, a cuisine, speciality or category, a search, a postcode. */
export interface ShopsQuery {
  section?: BrowseSection;
  cuisine?: string;
  speciality?: string;
  category?: string;
  q?: string;
  near?: string;
}

export function fetchShops(
  query: ShopsQuery = {},
): Promise<{ shops: PublicShop[]; near?: string | null; ranking?: string | null }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string' && value.trim() !== '') params.set(key, value.trim());
  }
  const search = params.toString();
  return request(search ? `/shops?${search}` : '/shops');
}

export interface PublicShopProduct {
  id: string;
  name: string;
  pricePence: number;
  tags: string;
  expiresOn: string | null;
  hasPhoto: boolean;
  catalogueItemId: string | null;
  durationMinutes?: number | null;
}

export interface PublicShopPage {
  shop: Omit<PublicShop, 'products'> & { address: string; claimable: boolean; awards?: string[] };
  products: PublicShopProduct[];
}

export function fetchShop(id: string): Promise<PublicShopPage> {
  return request(`/shops/${encodeURIComponent(id)}`);
}

/** Where a shop's product photo can be shown from. */
export function shopPhotoUrl(shopId: string, productId: string): string {
  return `${BASE_URL}/shops/${encodeURIComponent(shopId)}/products/${encodeURIComponent(productId)}/photo`;
}

export interface OrganisationDashboard {
  organisation: {
    id: string;
    name: string;
    joinCode: string | null;
    monthlyBudgetPence: number | null;
    staffTripCostPence: number | null;
  };
  totals: {
    spentThisMonthPence: number;
    spentLastMonthPence: number;
    spentAllTimePence: number;
    deliveriesThisMonth: number;
    budgetLeftPence: number | null;
    savedThisMonthPence: number | null;
    upcomingWeeklyPence: number;
  };
  byOffice: Array<{ office: string; pence: number }>;
  /** `agreed` false: linked before consent was recorded, so nothing of theirs is shown. */
  people: Array<{ id: string; name: string; office: string; agreed?: boolean }>;
  orders: Array<{
    id: string;
    person: string;
    office: string;
    createdAt: string;
    status: string;
    items: number;
    paidPence: number;
  }>;
  upcoming: Array<{ person: string; office: string; dayOfWeek: number; estimatePence: number }>;
  /** The Membership delivery for an everyday shop (the smallest band). */
  deliveryFeePence: number;
  /** Membership delivery by the value of the shop, in words: "£5.99 for shopping up to £60.00, and £9.99 over £60.00". */
  deliveryWords: string;
  /** What the organisation pays a month: £10 a client, every 51st client £5 (ruling 58). */
  plan?: {
    clients: number;
    monthlyPence: number;
    clientMonthlyPence: number;
    discountEveryNthClient: number;
    discountedClientMonthlyPence: number;
    discountedClients: number;
    words: string;
  };
  /** The link the organisation shares, for people to link to it. */
  sharePath: string | null;
  /** People linked, and accounts opened through the link. */
  referrals: number;
}

export function fetchOrganisationDashboard(): Promise<OrganisationDashboard> {
  return businessRequest('/organisation/dashboard');
}

export function saveOrganisationSettings(input: {
  monthlyBudgetPence?: number | null;
  staffTripCostPence?: number | null;
}): Promise<{ message: string }> {
  return businessRequest('/organisation/settings', { method: 'POST', body: JSON.stringify(input) });
}

export function setPersonOffice(id: string, office: string): Promise<{ message: string }> {
  return businessRequest(`/organisation/people/${encodeURIComponent(id)}/office`, {
    method: 'POST',
    body: JSON.stringify({ office }),
  });
}

export function fetchMyOrganisation(): Promise<{ organisation: { name: string } | null }> {
  return request('/me/organisation');
}

/**
 * Links the account to an organisation, after the person (or someone with legal authority to act
 * for them) agreed to the words shown, whose version is sent so the server keeps which words
 * they saw (30 October 2026, UK GDPR).
 */
export function joinOrganisation(
  code: string,
): Promise<{ organisation: { name: string }; message: string }> {
  return request('/me/organisation', {
    method: 'POST',
    body: JSON.stringify({ code, agreed: true, version: ORGANISATION_CONSENT_VERSION }),
  });
}

export function leaveOrganisation(): Promise<{ message: string }> {
  return request('/me/organisation/leave', { method: 'POST', body: JSON.stringify({}) });
}

export interface StaffPartners {
  shops: Array<
    {
      id: string;
      name: string;
      kind: PartnerKind;
      kindWords: string;
      status: 'pending' | 'approved' | 'removed';
      plan: 'free' | 'plus';
      freeForever: boolean;
      source: 'self' | 'staff' | 'ozi' | 'claimed';
      area: string;
      address: string;
      hours: string;
      contactName: string;
      email: string;
      listed: boolean;
      monthlyPence: number;
      paidUntil: string | null;
      paid: boolean;
      active: boolean;
      spotlightActive: boolean;
      live: number;
      waiting: number;
      users: Array<{ id: string; name: string; username: string }>;
      /** Another listing of the same business it is a branch of (30 October 2026), or null. */
      branchOfShopId?: string | null;
      /** A restaurant's agreed discount for Ozi, a whole percentage (30 October 2026). */
      agreedDiscountPercent?: number;
      /** The agreed mark-up on its prices, a whole percentage (30 October 2026). */
      agreedMarkupPercent?: number;
      /**
       * Signed up by an Ozi Ambassador (30 October 2026): the reference on its printed agreement
       * sheet, needed to approve it, and the mark-up and discount proposed for staff to confirm.
       */
      agreementReference?: string | null;
      proposedMarkupPercent?: number | null;
      proposedDiscountPercent?: number | null;
      preferredPartner?: boolean;
    } & Partial<BrowseFields>
  >;
  organisations: Array<{
    id: string;
    name: string;
    joinCode: string | null;
    people: number;
    users: Array<{ id: string; name: string; username: string; office: string }>;
  }>;
  plusMonthlyPence: number;
  freeListingCount: number;
  freeListed: number;
  freeProductLimit: number;
  restaurantWords: string;
  preferredDiscountPercent: number;
  maximumDiscountPercent: number;
  /** The largest mark-up staff may record (30 October 2026). */
  maximumMarkupPercent?: number;
  spotlightPence: number;
  spotlightPlusPence: number;
  /** How many shops config/shops-seed.json names. */
  seedShops: number;
}

export function fetchStaffPartners(key: string): Promise<StaffPartners> {
  return staffRequest(key, '/staff/partners');
}

/** Staff add a shop from a paper form (ruling 65): approved at once, the agreement being on paper. */
export function addStaffPartner(
  key: string,
  input: {
    name: string;
    kind?: PartnerKind;
    address: string;
    postcode?: string;
    hours?: string;
    contactName?: string;
    mobile?: string;
    email?: string;
    telephone: string;
    about: string;
    plan?: 'free' | 'plus';
    paidMonths: number;
  } & Partial<BrowseFields>,
): Promise<unknown> {
  return staffRequest(key, '/staff/partners', { method: 'POST', body: JSON.stringify(input) });
}

/** Approve a pending listing, pause or resume it, or remove it. */
export function setStaffPartnerState(
  key: string,
  id: string,
  change: {
    status?: 'approved' | 'pending' | 'removed';
    active?: boolean;
    /** "A branch of" another listing of the same business, or null for none (30 October 2026). */
    branchOfShopId?: string | null;
    /** The reference on its agreement sheet, to approve a business an Ambassador signed up. */
    agreementReference?: string;
  } & Partial<BrowseFields>,
): Promise<unknown> {
  return staffRequest(key, `/staff/partners/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify(change),
  });
}

/** The shops Ozi lists itself, from config: adds only the ones not there yet. */
export function seedStaffShops(
  key: string,
): Promise<{ added: number; skipped: number; message: string }> {
  return staffRequest(key, '/staff/partners/seed', { method: 'POST', body: JSON.stringify({}) });
}

export function renewStaffPartner(key: string, id: string, paidMonths: number): Promise<unknown> {
  return staffRequest(key, `/staff/partners/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify({ paidMonths }),
  });
}

export function addBusinessUser(
  key: string,
  kind: 'partners' | 'organisations',
  id: string,
  input: { name: string; username: string; office?: string },
): Promise<{ message: string }> {
  return staffRequest(key, `/staff/${kind}/${encodeURIComponent(id)}/users`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function addStaffOrganisation(
  key: string,
  input: { name: string; contactName: string; contactEmail: string; contactPhone?: string },
): Promise<unknown> {
  return staffRequest(key, '/staff/organisations', { method: 'POST', body: JSON.stringify(input) });
}

export interface StaffPartnerProduct extends PartnerProductRow {
  shopName: string;
}

export function fetchStaffPartnerProducts(
  key: string,
): Promise<{ products: StaffPartnerProduct[] }> {
  return staffRequest(key, '/staff/partner-products');
}

export function decideStaffPartnerProduct(
  key: string,
  id: string,
  approve: boolean,
  note?: string,
): Promise<unknown> {
  return staffRequest(key, `/staff/partner-products/${encodeURIComponent(id)}/decide`, {
    method: 'POST',
    body: JSON.stringify({ approve, ...(note ? { note } : {}) }),
  });
}

/* ------------------------------------------------------------------------------------- *
 * Spotlight, payment history, statements and business analysis (7 October 2026)
 * ------------------------------------------------------------------------------------- */

export interface PartnerPaymentRow {
  id: string;
  kind: 'plan' | 'spotlight' | 'plus';
  what: string;
  amountPence: number;
  months: number;
  coversUntil: string;
  paidAt: string;
}

export interface PartnerExtras {
  spotlight: {
    level: 'none' | 'spotlight' | 'plus';
    until: string | null;
    mentionsThisMonth: number;
    /** An Ozi Preferred Partner's free Spotlight week this month, still to take. */
    freeWeekLeft?: boolean;
    prices: {
      spotlightPence: number;
      plusPence: number;
      spotlightPerWeek: number;
      plusPerWeek: number;
    };
  };
  payments: PartnerPaymentRow[];
  referrals: number;
  numbers: { purchasesThisWeek: number; purchasesThisMonth: number; itemsThisMonth: number };
}

/** Downloads a statement as a PDF file, signed in as the business. */
export async function downloadBusinessStatement(
  kind: 'partner' | 'organisation',
  name: string,
): Promise<void> {
  const response = await fetch(`${BASE_URL}/${kind}/statement.pdf`, {
    headers: { 'x-business-token': businessToken() },
  });
  if (!response.ok)
    throw new ApiError('The statement could not be made just now.', response.status, undefined);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name} statement.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

export interface Advert {
  shopId: string;
  shopName: string;
  productName: string;
  pricePence: number;
  catalogueItemId: string | null;
  words: string;
}

export function fetchAdvert(query: string): Promise<{ advert: Advert | null }> {
  return request(`/spotlight?q=${encodeURIComponent(query)}`);
}

/** Staff set a restaurant's agreed discount for Ozi, a whole percentage (30 October 2026). */
export function setStaffPartnerDiscount(
  key: string,
  id: string,
  agreedDiscountPercent: number,
  agreedMarkupPercent?: number,
): Promise<unknown> {
  return staffRequest(key, `/staff/partners/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify({
      agreedDiscountPercent,
      ...(agreedMarkupPercent !== undefined ? { agreedMarkupPercent } : {}),
    }),
  });
}

/** Staff give a Preferred Partner its free Spotlight week for this month (30 October 2026). */
export function grantFreeSpotlightWeek(key: string, id: string): Promise<{ message: string }> {
  return staffRequest(key, `/staff/partners/${encodeURIComponent(id)}/free-spotlight-week`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** One restaurant partner on the staff list (30 October 2026). */
export interface StaffRestaurantRow {
  id: string;
  name: string;
  area: string;
  listed: boolean;
  discountPercent: number;
  /** The agreed mark-up on its prices (Anthony, 30 October 2026). */
  markupPercent: number;
  preferredPartner: boolean;
  ordersLast30Days: number;
}

export type StaffRestaurantSort = 'name' | 'discount' | 'markup' | 'preferred' | 'orders';

export interface StaffRestaurants {
  restaurants: StaffRestaurantRow[];
  sort: StaffRestaurantSort;
  order: 'asc' | 'desc';
  preferredDiscountPercent: number;
  withDiscount: number;
  withoutDiscount: number;
  preferred: number;
}

export function fetchStaffRestaurants(
  key: string,
  sort: StaffRestaurantSort,
  order: 'asc' | 'desc',
): Promise<StaffRestaurants> {
  return staffRequest(key, `/staff/restaurants?sort=${sort}&order=${order}`);
}

/** One row of the Checkout insights page. */
export interface InsightRow {
  label: string;
  viewed: number;
  paid: number;
  abandoned: number;
  paidPercent: number | null;
}

export interface CheckoutInsights {
  days: number;
  periods: number[];
  viewed: number;
  paid: number;
  abandoned: number;
  paidPercent: number | null;
  byTotal: InsightRow[];
  byKind: InsightRow[];
  byArea: InsightRow[];
  byWarning: InsightRow[];
  byShopper: InsightRow[];
  byChannel: InsightRow[];
  reasons: Array<{ answer: string; label: string; count: number }>;
  summary: string;
}

export function fetchCheckoutInsights(key: string, days: number): Promise<CheckoutInsights> {
  return staffRequest(key, `/staff/checkout-insights?days=${days}`);
}

export function recordStaffPartnerPayment(
  key: string,
  id: string,
  kind: 'plan' | 'spotlight' | 'plus',
  paidMonths = 1,
): Promise<unknown> {
  return staffRequest(key, `/staff/partners/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify({ kind, paidMonths }),
  });
}

export interface AnalyticsGroup {
  key: string;
  purchases: number;
  items: number;
  goodsPence: number;
  people: number;
}

export interface StaffAnalytics {
  period: 'day' | 'week' | 'month' | 'year';
  minimumGroup: number;
  totals: {
    purchases: number;
    goodsPence: number;
    shoppers: number | null;
    runners: number;
    throughOrganisations: number;
  };
  windows: Array<{ window: string; purchases: number; goodsPence: number }>;
  shops: Array<{
    shop: string;
    purchases: number;
    items: number;
    goodsPence: number;
    people: number | null;
  }>;
  hours: Array<{ hour: number; purchases: number }>;
  weekdays: Array<{ day: string; purchases: number }>;
  ageBands: { rows: AnalyticsGroup[]; hiddenGroups: number };
  areas: { rows: AnalyticsGroup[]; hiddenGroups: number };
  categories: Array<{ category: string; purchases: number; items: number }>;
  routes: Array<{ route: string; deliveries: number }>;
  travel: Array<{ mode: string; deliveries: number }>;
  topSearches: Array<{ term: string; count: number }>;
  unmetSearches: Array<{ term: string; count: number }>;
}

export function fetchStaffAnalytics(
  key: string,
  period: StaffAnalytics['period'],
): Promise<StaffAnalytics> {
  return staffRequest(key, `/staff/analytics?period=${period}`);
}

/* ------------------------------------------------------------------------------------- *
 * The owner (ruling 43): money, overview, passcode, two-step codes, kill switch, and who
 * sees his dashboard.
 * ------------------------------------------------------------------------------------- */

export interface MoneyTotals {
  inPence: number;
  outPence: number;
  netPence: number;
  byGateway: Array<{ name: string; pence: number }>;
  byKind: Array<{ name: string; pence: number }>;
}

export interface OwnerMoney {
  gateways: Array<{ name: string; connected: boolean }>;
  today: MoneyTotals;
  week: MoneyTotals;
  month: MoneyTotals;
  year: MoneyTotals;
  allTime: MoneyTotals;
  /** What Runners were paid back for the shopping (ruling 55). Passed straight through. */
  runnerPayBack?: {
    todayPence: number;
    weekPence: number;
    monthPence: number;
    allTimePence: number;
    waitingCount: number;
    waitingPence: number;
    owedCount: number;
    owedPence: number;
  };
  /** The Runner spending cards (Stripe Issuing): each card, each card order, the declines. */
  runnerCards?: {
    enabled: boolean;
    cards: Array<{
      runnerId: string;
      name: string;
      last4: string | null;
      status: 'active' | 'inactive';
      chosen: 'card' | 'own';
    }>;
    orders: Array<{
      orderId: string;
      /** The short reference staff say aloud; the full id is never shown on the screen. */
      reference?: string;
      runnerName: string;
      loadedPence: number | null;
      spentPence: number | null;
      merchant: string | null;
      receiptPence: number | null;
      needsPerson: boolean;
      at: string;
    }>;
    declines: Array<{
      at: string;
      runnerName: string;
      orderId: string | null;
      amountPence: number;
      merchant: string;
      reason: string;
    }>;
  };
  recent: Array<{
    at: string;
    gateway: string;
    kind: string;
    amountPence: number;
    reference: string;
  }>;
}

export function fetchOwnerMoney(key: string): Promise<OwnerMoney> {
  return staffRequest(key, '/staff/money');
}

/** One thing that needs a person now (16 October 2026 review), most urgent first. */
export interface NeedsYouCard {
  key: 'sos' | 'waiting-orders' | 'bank-transfers' | 'pay-backs' | 'problems' | 'documents';
  count: number;
  /** "one SOS", "two bank transfers to check". */
  words: string;
  title: string;
  /** The button's words. */
  action: string;
  /** The tab the button opens. */
  tab: StaffArea;
}

export function fetchNeedsYou(
  key: string,
): Promise<{ cards: NeedsYouCard[]; splitAfterMinutes: number }> {
  return staffRequest(key, '/staff/needs-you');
}

/** Something Ozi rings the owner about (ruling 74, Ozi's desk). */
export interface OwnerMatter {
  id: string;
  kind: string;
  /** One or two sentences, as Ozi says them on the call. */
  summary: string;
  /** decide: approve, decline or later. acknowledge: heard, or later. */
  options: 'decide' | 'acknowledge';
  urgent: boolean;
  status: 'open' | 'later';
  laterUntil: string | null;
  createdAt: string;
  callAttempts: number;
  /** For an email (ruling 76): who it is from and its subject. Older servers leave them out. */
  emailFrom?: string | null;
  emailSubject?: string | null;
}

export interface OwnerDesk {
  matters: OwnerMatter[];
  /** Whether Ozi can ring the owner: the alert phone and Twilio are set up. */
  ringing: boolean;
  lastCall: { at: string; status: string; attempt: number } | null;
}

export function fetchOwnerDesk(key: string): Promise<OwnerDesk> {
  return staffRequest(key, '/staff/desk');
}

export function decideOwnerMatter(
  key: string,
  id: string,
  choice: 'approve' | 'decline' | 'acknowledge' | 'later',
): Promise<{ message: string }> {
  return staffRequest(key, `/staff/desk/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify({ choice }),
  });
}

export interface StaffOverview {
  /** What needs a person now, most urgent first. Older servers leave it out. */
  needsYou?: NeedsYouCard[];
  splitAfterMinutes?: number;
  people: {
    shoppers: number;
    runners: number;
    runnersOnShiftNow: number;
    shopPartners: number;
    organisations: number;
    staff: number;
  };
  staffByJob: Array<{ job: string; count: number }>;
  work: {
    ordersLastDay: number;
    ordersLastWeek: number;
    problemsWaiting: number;
    documentsWaiting: number;
    shopProductsWaiting: number;
    findItWaiting: number;
  };
}

export function fetchStaffOverview(key: string): Promise<StaffOverview> {
  return staffRequest(key, '/staff/overview');
}

export function fetchOwnerExists(key: string): Promise<{ ownerExists: boolean }> {
  return staffRequest(key, '/staff/owner');
}

export function setUpOwner(
  key: string,
  input: { name: string; username: string; password: string; passcode: string },
): Promise<{ message: string }> {
  return staffRequest(key, '/staff/owner', { method: 'POST', body: JSON.stringify(input) });
}

export function changePasscode(
  key: string,
  current: string,
  passcode: string,
): Promise<{ message: string }> {
  return staffRequest(key, '/staff/owner/passcode', {
    method: 'POST',
    body: JSON.stringify({ current, passcode }),
  });
}

export function startTwoStep(
  key: string,
): Promise<{ secret: string; otpauth: string; message: string }> {
  return staffRequest(key, '/staff/owner/two-step/start', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function confirmTwoStep(key: string, code: string): Promise<TwoStepConfirmed> {
  return staffRequest(key, '/staff/owner/two-step/confirm', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export function twoStepOff(key: string, passcode: string): Promise<{ message: string }> {
  return staffRequest(key, '/staff/owner/two-step/off', {
    method: 'POST',
    body: JSON.stringify({ passcode }),
  });
}

export function killSwitch(key: string, passcode: string): Promise<{ message: string }> {
  return staffRequest(key, '/staff/owner/kill-switch', {
    method: 'POST',
    body: JSON.stringify({ passcode }),
  });
}

export interface Viewer {
  id: string;
  name: string;
  username: string;
  kind: 'family' | 'investor';
  active: boolean;
  areas: StaffArea[];
  lastSignInAt: string | null;
}

export function fetchViewers(key: string): Promise<{ viewers: Viewer[]; areas: StaffArea[] }> {
  return staffRequest(key, '/staff/viewers');
}

export function addViewer(
  key: string,
  input: { name: string; username: string; kind: 'family' | 'investor' },
): Promise<{ viewer: Viewer; password: string; message: string }> {
  return staffRequest(key, '/staff/viewers', { method: 'POST', body: JSON.stringify(input) });
}

export function setViewer(
  key: string,
  id: string,
  change: { areas?: StaffArea[]; all?: boolean; active?: boolean },
): Promise<{ viewer: Viewer }> {
  return staffRequest(key, `/staff/viewers/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify(change),
  });
}

/* ------------------------------------------------------------------------------------- *
 * Ozi's everyday replies (ruling 44): kept on the server, one collection for each account.
 * ------------------------------------------------------------------------------------- */

/** Who is asking, which decides the collection: the server reads it from the credentials. */
export type OziAsker =
  { kind: 'shopper' } | { kind: 'runner' } | { kind: 'staff'; key: string } | { kind: 'business' };

/** One-way fingerprints of the whole phrases this account's Ozi knows (ruling 49). */
export function fetchKnownPhrases(as: OziAsker): Promise<{ fingerprints: string[] }> {
  if (as.kind === 'staff') return staffRequest(as.key, '/ozi/known');
  if (as.kind === 'business') return businessRequest('/ozi/known');
  return request('/ozi/known', undefined, as.kind);
}

/** What the language model heard in the words when the phrase book had nothing (ruling 69). */
export interface OziUnderstanding {
  kind:
    | 'items'
    | 'recommend'
    | 'question'
    | 'done'
    | 'stop'
    | 'remove'
    | 'repeat'
    | 'chatter'
    | 'unclear';
  items: Array<{ name: string; quantity: number; brand: string | null; detail: string | null }>;
  reply: string | null;
}

export function askOzi(
  text: string,
  mode: 'exact' | 'within',
  turn: number,
  as: OziAsker,
  basket?: string[],
): Promise<{ reply: string | null; understood?: OziUnderstanding }> {
  const init: RequestInit = {
    method: 'POST',
    body: JSON.stringify({
      text,
      mode,
      turn,
      conversation: conversationId(),
      ...(basket && basket.length > 0 ? { basket } : {}),
    }),
  };
  if (as.kind === 'staff') return staffRequest(as.key, '/ozi/reply', init);
  if (as.kind === 'business') return businessRequest('/ozi/reply', init);
  return request('/ozi/reply', init, as.kind);
}

/* ------------------------------------------------------------------------------------- *
 * Ozi's memory (ruling 68): what the app heard and what it said back, kept on the server so
 * a person can judge each answer and a language model can learn from it later.
 * ------------------------------------------------------------------------------------- */

export type ExchangeBrain =
  'phrases' | 'learned' | 'small-talk' | 'shops' | 'shopping' | 'flow' | 'model' | 'none';
export type ExchangeOutcome =
  | 'answered'
  | 'unanswered'
  | 'added'
  | 'not-found'
  | 'asked'
  | 'sent'
  | 'stopped'
  | 'refused'
  | 'ended';

let conversation: string | null = null;
/** One id for this visit, made in the app and never kept beyond it; the server one-way codes it. */
export function conversationId(): string {
  if (conversation === null) {
    const random =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    conversation = `visit:${random}`;
  }
  return conversation;
}

/**
 * Tells the server what the app said on its own. Fire and forget: a conversation is never
 * slowed down or stopped by its memory, so nothing here waits and nothing here throws.
 */
export function recordExchange(
  input: {
    heard: string;
    said: string;
    brain: ExchangeBrain;
    outcome: ExchangeOutcome;
    turn: number;
  },
  as: OziAsker = { kind: 'shopper' },
): void {
  try {
    const init: RequestInit = {
      method: 'POST',
      body: JSON.stringify({ ...input, conversation: conversationId() }),
      keepalive: true,
    };
    const sent =
      as.kind === 'staff'
        ? staffRequest<{ ok: boolean }>(as.key, '/ozi/heard', init)
        : as.kind === 'business'
          ? businessRequest<{ ok: boolean }>('/ozi/heard', init)
          : request<{ ok: boolean }>('/ozi/heard', init, as.kind);
    void sent.catch(() => undefined);
  } catch {
    // Nothing: memory never gets in the way of talking.
  }
}

export interface ExchangeRow {
  id: string;
  at: string;
  channel: 'app' | 'phone' | 'text';
  account: string;
  conversation: string;
  turn: number;
  heard: string;
  said: string;
  brain: ExchangeBrain | string;
  outcome: ExchangeOutcome | string;
  verdict: 'unrated' | 'right' | 'wrong';
  betterReply: string | null;
  ratedBy: string | null;
}

export interface MemoryCounts {
  total: number;
  unrated: number;
  right: number;
  wrong: number;
}

export function fetchMemory(
  key: string,
  where: { verdict?: 'unrated' | 'right' | 'wrong'; channel?: 'app' | 'phone' | 'text' } = {},
): Promise<{ counts: MemoryCounts; exchanges: ExchangeRow[] }> {
  const query = new URLSearchParams();
  if (where.verdict) query.set('verdict', where.verdict);
  if (where.channel) query.set('channel', where.channel);
  const tail = query.toString();
  return staffRequest(key, `/staff/memory${tail ? `?${tail}` : ''}`);
}

/** A price learned (ruling 72): off a till receipt, the open price database, or a web lookup. */
export interface PriceRow {
  id: string;
  name: string;
  pricePence: number;
  shop: string | null;
  source: 'receipt' | 'open_prices' | 'web';
  seenAt: string;
}

export function fetchPricesLearned(key: string): Promise<{ prices: PriceRow[] }> {
  return staffRequest(key, '/staff/prices');
}

export function judgeExchange(
  key: string,
  id: string,
  verdict: { verdict: 'right' | 'wrong'; betterReply?: string },
): Promise<{ message: string }> {
  return staffRequest(key, `/staff/memory/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify(verdict),
  });
}

/** The owner's training export: one JSON line per exchange. */
export function fetchMemoryExport(key: string): Promise<{ count: number; lines: string[] }> {
  return staffRequest(key, '/staff/memory/export');
}

/* ------------------------------------------------------------------------------------- *
 * A share link for everybody (ruling 44), with how many have joined through it.
 * ------------------------------------------------------------------------------------- */

export interface ShareLink {
  link: string;
  joined: number;
  /**
   * A Shopper's referral link for a driver (30 October 2026): it opens Runner sign-up, with the
   * Shopper recorded as the one who invited them.
   */
  runnerLink?: string;
}

/** A Shopper's own link. */
export function fetchMyShareLink(): Promise<ShareLink> {
  return request('/share');
}

/* ------------------------------------------------------------------------------------- *
 * Referral links, reward levels and Ozi Ambassadors (Anthony, 30 October 2026).
 * ------------------------------------------------------------------------------------- */

/** Whose dashboard it is: a Shopper, a Runner, or a shop or organisation signed in. */
export type ReferralAs = 'shopper' | 'runner' | 'business';

export interface ReferralLevelView {
  activeReferrals: number;
  rewardPence: number;
  label: string;
  reached: boolean;
  given: boolean;
}

export interface MyReferrals {
  referrals: {
    link: string;
    joined: number;
    active: number;
    progress: string;
    minimumActivePercent: number;
    levels: ReferralLevelView[];
    earned: Array<{ id: string; label: string; words: string; given: boolean }>;
    /** A level reached that Ozi has not said yet. Empty when there is none. */
    news: string;
  };
  ambassador: {
    joined: boolean;
    /**
     * Their application (Anthony, 30 October 2026): applied, documents sent, documents checked,
     * chat done, approved, declined, suspended, or documents needed for those who opted in before.
     * Missing from an older server.
     */
    status?: AmbassadorStatus | null;
    statusWords?: string | null;
    approved?: boolean;
    applicationMessage?: string | null;
    homePath?: string;
    applyPath?: string;
    agreedAt: string | null;
    termsVersion: string;
    /** Agreed to older Ambassador terms (30 October 2026): asked to agree again. */
    termsChanged?: boolean;
    termsChangedWords?: string | null;
    link: string | null;
    termsPath: string;
    profitShareWords: string;
    branchShareWords: string;
    planShareWords: string;
    months: number;
    /** Days an earning waits, pending, after the order is delivered. */
    holdDays: number;
    payoutMinimumWords: string;
    businesses: Array<{ name: string; approved: boolean; earnedPence?: number }>;
    earnedPence: number;
    /** Waiting for the refund window to pass. */
    pendingPence: number;
    /** Can be paid or withdrawn now. */
    availablePence: number;
    paidPence: number;
    /** Refunds that came after a share was available, each taken off. */
    deductions: Array<{ at: string; words: string }>;
    /** Suspended (31 October 2026): their earnings are kept, held until it ends. */
    held?: boolean;
    heldWords?: string | null;
    /** Declined, and the wait is over: they may apply again (31 October 2026). */
    canApplyAgain?: boolean;
    canWithdraw: boolean;
    /** Their bank details are set up with Stripe. */
    bankReady: boolean;
    withdrawals: Array<{ id: string; requestedAt: string; words: string }>;
  };
}

function referralRequest<T>(as: ReferralAs, path: string, init?: RequestInit): Promise<T> {
  if (as === 'business') return businessRequest<T>(path, init);
  return request<T>(path, init, as);
}

export function fetchMyReferrals(as: ReferralAs): Promise<MyReferrals> {
  return referralRequest(as, '/referrals/me');
}

/** Ozi has said the news of a level reached: it is not said again. */
export function markReferralNewsHeard(as: ReferralAs): Promise<{ told: number }> {
  return referralRequest(as, '/referrals/me/heard', { method: 'POST', body: '{}' });
}

/**
 * Where an Ambassador's withdrawals go: a one-time link to Stripe's own form, where the bank
 * details go straight to Stripe (30 October 2026).
 */
export function ambassadorBankLink(as: ReferralAs): Promise<{ url: string }> {
  return referralRequest(as, '/ambassador/bank', { method: 'POST', body: '{}' });
}

/** Everything available, once at least the minimum, to the Ambassador's bank. */
export function withdrawAmbassadorEarnings(
  as: ReferralAs,
): Promise<{ status: string; amountPence: number; message: string }> {
  return referralRequest(as, '/ambassador/withdraw', { method: 'POST', body: '{}' });
}

/**
 * Applying to be an Ozi Ambassador, step one: agreeing to the Ambassador terms of this version
 * (since 30 October 2026 an application, not an instant opt-in). Also how somebody on older terms
 * agrees to the new ones.
 */
export function becomeAmbassador(
  as: ReferralAs,
  termsVersion: string,
): Promise<{ link: string | null; message: string; application?: AmbassadorApplication }> {
  return referralRequest(as, '/ambassador/join', {
    method: 'POST',
    body: JSON.stringify({ termsAgreed: true, termsVersion }),
  });
}

export type AmbassadorStatus =
  | 'applied'
  | 'documents_sent'
  | 'documents_checked'
  | 'chat_done'
  | 'approved'
  | 'declined'
  | 'suspended'
  | 'documents_needed'
  | 'removed';

export type AmbassadorDocumentKind =
  'photo_id_front' | 'photo_id_back' | 'proof_of_address' | 'face_photo' | 'share_code';

export type AmbassadorIdType = 'passport' | 'driving_licence' | 'residence_card';
export type AmbassadorAddressType = 'utility_bill' | 'bank_letter' | 'council_tax';

/** Their own Ambassador application, as they see it (30 October 2026). */
export interface AmbassadorApplication {
  status: AmbassadorStatus;
  statusWords: string;
  idType: AmbassadorIdType | null;
  stillNeeded: Array<{ kind: AmbassadorDocumentKind; name: string }>;
  documents: Array<{
    id: string;
    kind: AmbassadorDocumentKind;
    name: string;
    status: 'submitted' | 'accepted' | 'rejected';
    reviewNote: string | null;
    sentAs: string;
    createdAt: string;
  }>;
  documentsIn: boolean;
  chatDone: boolean;
  reason: string | null;
  approved: boolean;
  message: string;
  /** The separate yes or no about comparing faces (31 October 2026). Missing from an older server. */
  faceConsentQuestion?: string;
  faceConsent?: boolean | null;
  faceConsentAt?: string | null;
  /** Declined, and the wait is over: they may apply again. */
  canApplyAgain?: boolean;
  applyAgainFrom?: string | null;
  held?: boolean;
}

/** The separate yes or no to comparing their face photo with the photo on their ID. */
export function setAmbassadorFaceConsent(
  as: ReferralAs,
  consent: boolean,
): Promise<{ application: AmbassadorApplication; message: string }> {
  return referralRequest(as, '/ambassador/face-consent', {
    method: 'POST',
    body: JSON.stringify({ consent }),
  });
}

export function fetchAmbassadorApplication(
  as: ReferralAs,
): Promise<{ application: AmbassadorApplication | null }> {
  return referralRequest(as, '/ambassador/application');
}

export function sendAmbassadorDocument(
  as: ReferralAs,
  input: {
    kind: AmbassadorDocumentKind;
    idType?: AmbassadorIdType;
    addressType?: AmbassadorAddressType;
    image?: string;
    contentType?: string;
    shareCode?: string;
  },
): Promise<{ application: AmbassadorApplication; message: string }> {
  return referralRequest(as, '/ambassador/documents', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** The Ambassador Toolkit's own links, for approved Ambassadors only (30 October 2026). */
export interface AmbassadorToolkit {
  name: string;
  firstName: string;
  businessLink: string;
  shopperLink: string;
  runnerLink: string;
  /** What is said for a business that has not signed the partner agreement in the app. */
  cardsWaitWords?: string;
  businesses: Array<{
    id: string;
    name: string;
    approved: boolean;
    statusWords: string;
    /**
     * Counter cards and window stickers only once it signed the partner agreement in the app (31
     * October 2026). Without it there is no shop link to print.
     */
    cardsAllowed?: boolean;
    shopLink: string | null;
    agreementReference: string | null;
  }>;
}

export function fetchAmbassadorToolkit(as: ReferralAs): Promise<AmbassadorToolkit> {
  return referralRequest(as, '/ambassador/toolkit');
}

/** One business's counter card or window sticker: refused unless it signed the agreement. */
export function fetchCounterCard(
  as: ReferralAs,
  shopId: string,
): Promise<{ id: string; name: string; shopLink: string }> {
  return referralRequest(as, `/ambassador/cards/${encodeURIComponent(shopId)}`);
}

export interface SignUpBusinessInput {
  name: string;
  kind: 'shop' | 'food' | 'service';
  address: string;
  postcode: string;
  hours: string;
  contactName: string;
  mobile: string;
  email: string;
  username: string;
  password: string;
  agreedMarkupPercent: number;
  agreedDiscountPercent: number;
  termsAgreed: true;
  ownerAgrees: true;
  ownerName: string;
  phoneProof?: string;
}

/** "Sign up this business now", with the owner present (30 October 2026). */
export function signUpBusinessNow(
  as: ReferralAs,
  input: SignUpBusinessInput,
): Promise<{ reference: string; message: string; shop: { id: string } }> {
  return referralRequest(as, '/ambassador/businesses', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** The printed Shop Partner agreement sheet's details, for the Ambassador who signed it up. */
export interface AgreementSheet {
  reference: string;
  business: string;
  kindWords: string;
  address: string;
  postcode: string;
  ownerName: string;
  agreedAt: string | null;
  termsVersion: string | null;
  markupPercent: number;
  discountPercent: number;
  status: string;
  ambassadorName: string;
  checkLink: string;
}

export function fetchAgreementSheet(as: ReferralAs, reference: string): Promise<AgreementSheet> {
  return referralRequest(as, `/ambassador/agreements/${encodeURIComponent(reference)}`);
}

/** Anyone: whether a Shop Partner agreement with this reference is real, and where it stands. */
export function checkPartnerAgreement(
  reference: string,
): Promise<{ found: boolean; reference: string; business?: string; statusWords?: string }> {
  return request(`/partner-agreements/${encodeURIComponent(reference)}`);
}

/* The staff Ambassadors page (30 October 2026). */

export interface StaffAmbassadorApplicationRow {
  id: string;
  kind: string;
  kindWords: string;
  accountId: string;
  name: string;
  area: string;
  status: AmbassadorStatus;
  statusWords: string;
  agreedAt: string;
  documentsSentAt: string | null;
  documentsCheckedAt: string | null;
  chatDoneAt: string | null;
  waitingDocuments: number;
  /** How the face is checked: by a person unless they said yes (31 October 2026). */
  faceCheck?: string;
}

export interface StaffAmbassadorApplication extends StaffAmbassadorApplicationRow {
  termsVersion: string;
  idType: AmbassadorIdType | null;
  chatDoneBy: string | null;
  chatNotes: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionReason: string | null;
  approvedAt: string | null;
  stillNeeded: Array<{ kind: AmbassadorDocumentKind; name: string }>;
  canRecordChat: boolean;
  canApprove: boolean;
  /** Suspend, Lift and Remove for fraud (31 October 2026). Missing from an older server. */
  canSuspend?: boolean;
  canDecline?: boolean;
  canLift?: boolean;
  canRemoveForFraud?: boolean;
  faceCompareConsent?: boolean | null;
  faceCompareConsentAt?: string | null;
  businesses?: Array<{ id: string; name: string; unpaidPence: number }>;
  identityMatches?: Array<{ id: string; kind: 'declined' | 'fraud'; words: string }>;
  documents: Array<{
    id: string;
    kind: AmbassadorDocumentKind;
    name: string;
    status: 'submitted' | 'accepted' | 'rejected';
    reviewNote: string | null;
    sentAs: string;
    createdAt: string;
    shareCode: string | null;
    hasFile: boolean;
    contentType: string | null;
    checkedAt: string | null;
    checkPassed: boolean | null;
    checkNote: string | null;
    checkName: string | null;
    checkIssuedOn: string | null;
    reviewedBy: string | null;
    reviewedAt: string | null;
  }>;
}

export function fetchStaffAmbassadorApplications(key: string): Promise<{
  groups: Array<{
    status: AmbassadorStatus;
    words: string;
    applications: StaffAmbassadorApplicationRow[];
  }>;
}> {
  return staffRequest(key, '/staff/ambassador-applications');
}

export function fetchStaffAmbassadorApplication(
  key: string,
  id: string,
): Promise<{ application: StaffAmbassadorApplication }> {
  return staffRequest(key, `/staff/ambassador-applications/${encodeURIComponent(id)}`);
}

export function reviewAmbassadorDocument(
  key: string,
  id: string,
  review: { decision: 'accept' | 'reject'; by: string; note?: string },
): Promise<unknown> {
  return staffRequest(key, `/staff/ambassador-documents/${encodeURIComponent(id)}/review`, {
    method: 'POST',
    body: JSON.stringify(review),
  });
}

/**
 * "Chat done", "Approve", "Decline" or "Suspend" on one application; or, to end a suspension,
 * "Lift" or "Remove for fraud" (31 October 2026).
 */
export function decideAmbassadorApplication(
  key: string,
  id: string,
  action: 'chat-done' | 'approve' | 'decline' | 'suspend' | 'lift' | 'remove-for-fraud',
  body: {
    by: string;
    notes?: string;
    reason?: string;
    dateOfBirth?: string;
    shops?: string[] | 'all';
  },
): Promise<{ message: string }> {
  return staffRequest(key, `/staff/ambassador-applications/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface StaffReferrerRow {
  kind: string;
  id: string;
  name: string;
  kindWords: string;
  area: string;
  joined: number;
  active: number;
  percent: string;
  meetsShare: boolean;
  level: { id: string; label: string; rewardPence: number; given: boolean } | null;
  levels: Array<{
    id: string;
    label: string;
    activeReferrals: number;
    rewardPence: number;
    reachedAt: string;
    givenAt: string | null;
    givenBy: string | null;
    /** The voucher sent for it, if one was (30 October 2026). */
    voucher?: StaffVoucher | null;
  }>;
}

/** A sent referral voucher as staff see it on the list: the code's last four only. */
export interface StaffVoucher {
  id: string;
  levelId: string;
  label: string;
  status: 'sent' | 'opened' | 'used';
  sentAt: string;
  sentByName: string;
  openedAt: string | null;
  usedAt: string | null;
  codeMasked: string;
  codeLastFour: string;
  hasLink: boolean;
  erased: boolean;
  nextReminderAt: string | null;
  reminders: Array<{ number: number; at: string; via: string; words: string }>;
}

/** "Send voucher": the code staff pasted, and a link if they have one, to the person's inbox. */
export function sendReferralVoucher(
  key: string,
  levelId: string,
  input: { code: string; link?: string; by: string },
): Promise<{ voucher: StaffVoucher; message: string }> {
  return staffRequest(key, `/staff/referrals/levels/${encodeURIComponent(levelId)}/voucher`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Opening a sent voucher's record: the code in full, written in the audit log. */
export function openReferralVoucher(
  key: string,
  id: string,
): Promise<{ voucher: StaffVoucher & { code: string; link: string | null } }> {
  return staffRequest(key, `/staff/referrals/vouchers/${encodeURIComponent(id)}`);
}

export interface StaffAmbassadorRow {
  kind: string;
  id: string;
  name: string;
  kindWords: string;
  area: string;
  businesses: Array<{
    id: string;
    name: string;
    approved: boolean;
    branch: boolean;
    earnedPence: number;
  }>;
  earnedPence: number;
  earnedThisMonthPence: number;
  pendingPence: number;
  availablePence: number;
  paidPence: number;
  deductionsPence: number;
  deductions: Array<{ at: string; amountPence: number; words: string }>;
  withdrawingPence: number;
  shortfallPence: number;
  payable: boolean;
  flagged: boolean;
  flagReason: string | null;
  waitingWithdrawals: Array<{
    id: string;
    amountPence: number;
    requestedAt: string;
    waitingReason: string | null;
  }>;
}

export interface StaffReferrals {
  levels: Array<{ activeReferrals: number; rewardPence: number; label: string }>;
  minimumActivePercent: number;
  givenAs: string;
  referrers: StaffReferrerRow[];
  ambassadors: StaffAmbassadorRow[];
}

export function fetchStaffReferrals(key: string, search = ''): Promise<StaffReferrals> {
  const query = search.trim() === '' ? '' : `?search=${encodeURIComponent(search.trim())}`;
  return staffRequest(key, `/staff/referrals${query}`);
}

export interface StaffReferrerDetail {
  referrer: {
    name: string;
    kindWords: string;
    area: string;
    joined: number;
    active: number;
    percent: string;
  };
  people: Array<{
    name: string;
    kindWords: string;
    joinedAt: string;
    active: boolean;
    reason: string;
  }>;
}

export function fetchStaffReferrer(
  key: string,
  kind: string,
  id: string,
): Promise<StaffReferrerDetail> {
  return staffRequest(
    key,
    `/staff/referrals/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
  );
}

export function markReferralRewardGiven(
  key: string,
  levelId: string,
  by: string,
): Promise<{ message: string }> {
  return staffRequest(key, `/staff/referrals/levels/${encodeURIComponent(levelId)}/given`, {
    method: 'POST',
    body: JSON.stringify({ by }),
  });
}

export function markAmbassadorPaid(
  key: string,
  kind: string,
  id: string,
  by: string,
): Promise<{ message: string }> {
  return staffRequest(
    key,
    `/staff/ambassadors/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/paid`,
    { method: 'POST', body: JSON.stringify({ by }) },
  );
}

export function decideAmbassadorWithdrawal(
  key: string,
  id: string,
  decision: 'approve' | 'refuse',
  by: string,
): Promise<{ message: string }> {
  return staffRequest(key, `/staff/ambassadors/withdrawals/${encodeURIComponent(id)}/${decision}`, {
    method: 'POST',
    body: JSON.stringify({ by }),
  });
}

/** Flagged: every withdrawal of theirs waits for a person to approve it. */
export function flagAmbassador(
  key: string,
  kind: string,
  id: string,
  flagged: boolean,
  reason: string,
): Promise<{ message: string }> {
  return staffRequest(
    key,
    `/staff/ambassadors/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/flag`,
    { method: 'POST', body: JSON.stringify({ flagged, reason }) },
  );
}

/** A staff member's, the owner's, a family member's or an investor's link. */
export function fetchStaffShareLink(key: string): Promise<ShareLink> {
  return staffRequest(key, '/share');
}

/* ------------------------------------------------------------------------------------- *
 * What Ozi could not answer, waiting for a person to approve an answer (ruling 49).
 * ------------------------------------------------------------------------------------- */

export interface LearningRow {
  id: string;
  account: string;
  text: string;
  timesHeard: number;
  lastHeardAt: string;
}

export function fetchLearning(key: string): Promise<{ waiting: LearningRow[] }> {
  return staffRequest(key, '/staff/learning');
}

export function decideLearning(
  key: string,
  id: string,
  decision: { approve: boolean; reply?: string },
): Promise<{ message: string }> {
  return staffRequest(key, `/staff/learning/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify(decision),
  });
}

/* ------------------------------------------------------------------------------------- *
 * Bank transfers to the business account, for staff to mark as received (ruling 50).
 * ------------------------------------------------------------------------------------- */

export interface BankPaymentRow {
  orderId: string;
  reference: string | null;
  amountPence: number;
  shopperName: string;
  placedAt: string;
  receivedAt: string | null;
  status: string;
}

export function fetchBankPayments(
  key: string,
): Promise<{ waiting: BankPaymentRow[]; received: BankPaymentRow[] }> {
  return staffRequest(key, '/staff/payments');
}

export function markBankPayment(
  key: string,
  orderId: string,
  outcome: 'received' | 'cancel',
): Promise<{ message: string }> {
  return staffRequest(key, `/staff/payments/${encodeURIComponent(orderId)}/${outcome}`, {
    method: 'POST',
  });
}

/** A tiny extra (ruling 61): a linked order after the first with under £5 of shopping. */
export interface TinyExtraRow {
  orderId: string;
  reference: string;
  firstOrderId: string | null;
  firstReference: string | null;
  part: number | null;
  of: number | null;
  goodsPence: number;
  extraDeliveryPence: number;
  items: string[];
  firstRunner: { name: string; phone: string } | null;
  firstStatus: string | null;
}

export function fetchTinyExtras(key: string): Promise<{ tinyExtras: TinyExtraRow[] }> {
  return staffRequest(key, '/staff/tiny-extras');
}

export function carryWithFirstRunner(key: string, orderId: string): Promise<{ message: string }> {
  return staffRequest(key, `/staff/tiny-extras/${encodeURIComponent(orderId)}/carry-with-first`, {
    method: 'POST',
  });
}

/* ------------------------------------------------------------------------------------- *
 * Paying Runners back for the shopping, for staff to approve when a person must (ruling 55).
 * ------------------------------------------------------------------------------------- */

export interface ReimbursementRow {
  orderId: string;
  reference: string;
  transferReference: string;
  runnerName: string;
  goodsEstimatePence: number;
  receiptTotalPence: number | null;
  amountPence: number;
  status: 'paid' | 'waiting' | 'owed';
  reason: string | null;
  approvedBy: string | null;
  paidAt: string | null;
  /** A photo of the till receipt came with it. */
  hasReceiptPhoto?: boolean;
}

export function fetchReimbursements(
  key: string,
): Promise<{ waiting: ReimbursementRow[]; owed: ReimbursementRow[]; paid: ReimbursementRow[] }> {
  return staffRequest(key, '/staff/reimbursements');
}

export function approveReimbursement(key: string, orderId: string): Promise<{ message: string }> {
  return staffRequest(key, `/staff/reimbursements/${encodeURIComponent(orderId)}/approve`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** The one word skip for the next regular order, after its notice (Rule Five). */
export function skipWeeklyShop(id: string): Promise<{ message: string }> {
  return request(`/sets/${encodeURIComponent(id)}/skip`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/* ------------------------------------------------------------------------------------- *
 * After a delivery, and closing an account
 * ------------------------------------------------------------------------------------- */

/* ------------------------------------------------------------------------------------- *
 * Shop reviews, review points and Shop of the Month (ruling 70)
 * ------------------------------------------------------------------------------------- */

export interface PendingShopReview {
  orderId: string;
  deliveredAt: string;
  shop: { id: string; name: string };
}

export interface ReviewPointsBalance {
  points: number;
  pendingPoints: number;
  worthPence: number;
  pointsToSpend: number;
  reviews: number;
  /** "You have 40 points, worth 40p." */
  words: string;
}

export interface ReviewRules {
  pointsPerReview: number;
  pencePerPoint: number;
  spendFromPoints: number;
  pendingDays: number;
}

/** The shops the Shopper is asked to rate, and where their points stand. */
export function fetchPendingShopReviews(): Promise<{
  pending: PendingShopReview[];
  balance: ReviewPointsBalance;
  rules: ReviewRules;
}> {
  return request('/me/reviews/pending');
}

/** Rating a shop whose things were in a delivered order: the same points, one star or five. */
export function sendShopReview(
  orderId: string,
  input: { shop: string; stars: number; message?: string },
): Promise<{ points: number; pendingDays: number; balance: ReviewPointsBalance; message: string }> {
  return request(`/orders/${encodeURIComponent(orderId)}/shop-review`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface ShopAward {
  kind: 'month' | 'quarter' | 'half';
  title: string;
  shop: { id: string; name: string };
  reviews: number;
  average: number;
}

export interface ShopStanding {
  shop: { id: string; name: string };
  reviews: number;
  average: number;
  score: number;
  qualifies: boolean;
}

export interface ShopStandings {
  period: { kind: 'month' | 'quarter' | 'half'; words: string; title: string };
  minimumReviews: number;
  rows: ShopStanding[];
  winner?: ShopStanding | null;
}

/** Public: who holds the awards, and this month's top five. */
export function fetchShopOfTheMonth(): Promise<{ awards: ShopAward[]; standings: ShopStandings }> {
  return request('/shops/of-the-month');
}

/** Staff: the full standings for the month, the quarter and the half year. */
export function fetchStaffShopOfTheMonth(key: string): Promise<{
  awards: ShopAward[];
  standings: { month: ShopStandings; quarter: ShopStandings; half: ShopStandings };
}> {
  return staffRequest(key, '/staff/shop-of-the-month');
}

/** Feedback after a delivery (Section O). Anything at all earns the delivery credit, once. */
export function sendOrderFeedback(
  orderId: string,
  input: { rating?: number; themes?: string[]; message?: string },
): Promise<{ creditPence: number; message: string }> {
  return request(`/orders/${encodeURIComponent(orderId)}/feedback`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Close the account: it waits a few days in case of a change of mind, then it is removed. */
export function closeAccount(): Promise<{
  deletionScheduledFor: string;
  recycleBinDays: number;
  message: string;
}> {
  return request('/account/delete', { method: 'POST', body: JSON.stringify({}) });
}

export function keepAccount(): Promise<{ restored: boolean; message: string }> {
  return request('/account/restore', { method: 'POST', body: JSON.stringify({}) });
}

/* ------------------------------------------------------------------------------------- *
 * The owner's till screen (Payments tab): till totals a person settles with the Shopper
 * ------------------------------------------------------------------------------------- */

export interface TillCaseRow {
  orderId: string;
  reference: string;
  shopperName: string;
  paidBy: 'card' | 'bank';
  bankReference: string | null;
  estimatePence: number;
  tillTotalPence: number | null;
  receiptTotalPence: number | null;
  /** Positive: more to take. Negative: to give back. */
  differencePence: number;
  reason: string | null;
  status: 'needs_person' | 'settled';
  settledBy: string | null;
  settledAt: string | null;
  hasReceiptPhoto: boolean;
}

export function fetchTillCases(
  key: string,
): Promise<{ waiting: TillCaseRow[]; settled: TillCaseRow[] }> {
  return staffRequest(key, '/staff/till-cases');
}

export type TillAction = 'charge' | 'refund' | 'refunded_by_hand' | 'collected_by_hand' | 'let_go';

export function settleTillCase(
  key: string,
  orderId: string,
  action: TillAction,
): Promise<{ message: string }> {
  const path = action === 'charge' || action === 'refund' ? action : 'settle';
  return staffRequest(key, `/staff/till-cases/${encodeURIComponent(orderId)}/${path}`, {
    method: 'POST',
    body: JSON.stringify(path === 'settle' ? { outcome: action } : {}),
  });
}

/** The address of a receipt photo, for `fetchStaffFile`. */
export function receiptPhotoPath(orderId: string): string {
  return `/staff/orders/${encodeURIComponent(orderId)}/receipt-photo`;
}
/* ------------------------------------------------------------------------------------- *
 * Two-step codes for every staff sign-in (Section Q): set up with an authenticator app,
 * with recovery codes for a lost phone.
 * ------------------------------------------------------------------------------------- */

export interface TwoStepConfirmed {
  message: string;
  /** Each works once. Shown only now. */
  recoveryCodes?: string[];
  /** A fresh session, for someone who could only set two-step codes up until now. */
  token?: string;
}

export function startMyTwoStep(
  key: string,
): Promise<{ secret: string; otpauth: string; message: string }> {
  return staffRequest(key, '/staff/two-step/start', { method: 'POST', body: '{}' });
}

export function confirmMyTwoStep(key: string, code: string): Promise<TwoStepConfirmed> {
  return staffRequest(key, '/staff/two-step/confirm', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export function myTwoStepOff(key: string, password: string): Promise<{ message: string }> {
  return staffRequest(key, '/staff/two-step/off', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export function newRecoveryCodes(
  key: string,
  code: string,
): Promise<{ message: string; recoveryCodes: string[] }> {
  return staffRequest(key, '/staff/two-step/recovery-codes', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export function resetTeamTwoStep(key: string, id: string): Promise<{ message: string }> {
  return staffRequest(key, `/staff/team/${encodeURIComponent(id)}/two-step-reset`, {
    method: 'POST',
    body: '{}',
  });
}

/* ------------------------------------------------------------------------------------- *
 * The admin panel's reports (Section Q): orders and their timelines, Runners working now,
 * signups, cancellations, refunds and price freshness; for the owner alone, Shoppers'
 * accounts, their data, and the audit log.
 * ------------------------------------------------------------------------------------- */

function query(params: Record<string, string | number | undefined>): string {
  const pairs = Object.entries(params).filter(
    (pair): pair is [string, string | number] => pair[1] !== undefined && pair[1] !== '',
  );
  return pairs.length === 0
    ? ''
    : `?${pairs.map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`).join('&')}`;
}

export interface StaffOrderRow {
  id: string;
  reference: string;
  status: string;
  statusWords: string;
  createdAt: string;
  shopperName: string | null;
  shopperHandle: string | null;
  runnerName: string | null;
  itemCount: number;
  totalEstimatePence: number;
  finalTotalPence: number | null;
  paidBy: 'card' | 'bank';
  area: string | null;
  cancelReason: string | null;
}

export function fetchStaffOrders(
  key: string,
  filters: {
    view?: 'live' | 'past' | 'all';
    status?: string;
    search?: string;
    from?: string;
    to?: string;
  } = {},
): Promise<{ orders: StaffOrderRow[]; statuses: Array<{ status: string; words: string }> }> {
  return staffRequest(key, `/staff/orders${query(filters)}`);
}

export interface StaffOrderDetail {
  order: StaffOrderRow & {
    goodsEstimatePence: number;
    feePence: number;
    receiptTotalPence: number | null;
    runnerId?: string | null;
    /** What can still go back to the card: the order cost, less what already has. */
    refundablePence?: number;
    goodwillRefundedPence?: number;
    items: Array<{ name: string; quantity: number; outcome: string }>;
  };
  timeline: Array<{ at: string; what: string }>;
}

export function fetchStaffOrder(key: string, id: string): Promise<StaffOrderDetail> {
  return staffRequest(key, `/staff/orders/${encodeURIComponent(id)}`);
}

/* The order rescue tools (16 October 2026 review): each is written in the audit log. */

export function cancelStaffOrder(
  key: string,
  id: string,
  input: { reason: string; by: string },
): Promise<{ message: string; refundedPence: number; bankRefundPence: number }> {
  return staffRequest(key, `/staff/orders/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function goodwillStaffRefund(
  key: string,
  id: string,
  input: { amountPence: number; reason: string; by: string },
): Promise<{ message: string }> {
  return staffRequest(key, `/staff/orders/${encodeURIComponent(id)}/goodwill`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface AssignableRunner {
  id: string;
  name: string;
  onShift: boolean;
  travel: string;
}

/** Approved Runners a stuck order could be given to, those on shift first. */
export function fetchStaffOrderRunners(
  key: string,
  id: string,
): Promise<{ runners: AssignableRunner[] }> {
  return staffRequest(key, `/staff/orders/${encodeURIComponent(id)}/runners`);
}

export function reassignStaffOrder(
  key: string,
  id: string,
  input: { runnerId?: string; by: string },
): Promise<{ message: string; released: string | null; offeredTo: string | null }> {
  return staffRequest(key, `/staff/orders/${encodeURIComponent(id)}/reassign`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface RunnerNowRow {
  id: string;
  name: string;
  onShift: boolean;
  activeNow: boolean;
  travel: string;
  job: { id: string; reference: string; status: string } | null;
  jobsCompleted: number;
  jobsToday: number;
  earnedTodayPence: number;
  earnedWeekPence: number;
  earnedAllTimePence: number;
  /**
   * On a job: when their phone last shared where they are, and a maps link to it (30 October
   * 2026). Null when it never has.
   */
  lastSeenAt?: string | null;
  mapsLink?: string | null;
}

export interface RunnersNow {
  activeNow: number;
  onShift: number;
  onAJob: number;
  runners: RunnerNowRow[];
}

export function fetchRunnersNow(key: string): Promise<RunnersNow> {
  return staffRequest(key, '/staff/runners/now');
}

/** One UK area on the Areas page (Anthony, 30 October 2026). */
export interface AreaRow {
  area: string;
  name: string;
  /** An approved Runner able to work lives there (30 October 2026: every area is open). */
  hasRunner: boolean;
  paused: boolean;
  /** Shoppers ordering there are warned gently: no Runner, or paused. */
  warn: boolean;
  statusWords: string;
  shoppers: number;
  runnersApproved: number;
  runnersWaiting: number;
  shopsApproved: number;
  shopsWaiting: number;
  organisations: number;
  /** Shoppers warned there was no Runner, to be texted once when one joins. */
  waitingList: number;
  ordersToday: number;
  ordersThisWeek: number;
  pausedBy: string | null;
}

export function fetchStaffAreas(key: string): Promise<{ areas: AreaRow[] }> {
  return staffRequest(key, '/staff/areas');
}

export function pauseStaffArea(
  key: string,
  area: string,
  paused: boolean,
  by: string,
): Promise<{ message: string }> {
  return staffRequest(key, `/staff/areas/${encodeURIComponent(area)}/pause`, {
    method: 'POST',
    body: JSON.stringify({ paused, by }),
  });
}

export interface SignupBucket {
  label: string;
  from: string;
  to: string;
  shoppers: number;
  runners: number;
}

export function fetchSignups(
  key: string,
  period: 'day' | 'week' | 'month',
  range: { from?: string; to?: string } = {},
): Promise<{
  period: string;
  buckets: SignupBucket[];
  /** Given a from: who signed up between the two moments. */
  between: { from: string; to: string; shoppers: number; runners: number } | null;
}> {
  return staffRequest(key, `/staff/reports/signups${query({ period, ...range })}`);
}

export interface CancellationsReport {
  from: string;
  to: string;
  count: number;
  byReason: Array<{ reason: string; count: number }>;
  cancellations: Array<{ id: string; reference: string; at: string; reason: string }>;
}

export function fetchCancellations(
  key: string,
  range: { from?: string; to?: string } = {},
): Promise<CancellationsReport> {
  return staffRequest(key, `/staff/reports/cancellations${query(range)}`);
}

export interface RefundsReport {
  from: string;
  to: string;
  count: number;
  /** Null for everyone but the owner: money totals are his alone. */
  totalPence: number | null;
  ownerOnlyAbovePence: number;
  byReason: Array<{ reason: string; count: number }>;
  refunds: Array<{
    at: string;
    amountPence: number;
    kind: string;
    group: string;
    reason: string;
    orderId: string | null;
    decidedBy: string | null;
  }>;
}

export function fetchRefunds(
  key: string,
  range: { from?: string; to?: string } = {},
): Promise<RefundsReport> {
  return staffRequest(key, `/staff/reports/refunds${query(range)}`);
}

export interface PriceFreshness {
  catalogue: {
    total: number;
    fresh: number;
    ageing: number;
    stale: number;
    oldest: Array<{
      id: string;
      name: string;
      category: string;
      pricePence: number;
      lastSeenAt: string;
    }>;
  };
  shops: Array<{
    id: string;
    name: string;
    products: number;
    lastUpdatedAt: string | null;
    stale: boolean;
  }>;
}

export function fetchPriceFreshness(key: string): Promise<PriceFreshness> {
  return staffRequest(key, '/staff/reports/prices');
}

export function searchShopperAccounts(
  key: string,
  search: string,
): Promise<{
  shoppers: Array<{ id: string; displayName: string; handle: string; createdAt: string }>;
}> {
  return staffRequest(key, `/staff/shoppers${query({ search })}`);
}

export interface ShopperAccountView {
  account: Record<string, unknown> & {
    id: string;
    displayName: string;
    handle: string;
    phone: string;
    deliveryAddress: string;
    createdAt: string;
  };
  savedAddresses: Array<{ label: string; address: string }>;
  cards: Array<{ brand: string | null; lastFour: string; isDefault: boolean }>;
  orders: Array<{
    id: string;
    reference: string;
    status: string;
    createdAt: string;
    totalEstimatePence: number;
    finalTotalPence: number | null;
    items: string;
  }>;
  regularOrders: Array<{ name: string; frequency: string; active: boolean; items: string }>;
  problems: Array<{ orderId: string; summary: string; decision: string | null }>;
  findIt: Array<{ description: string; status: string }>;
  giftCardsBought: Array<{ amountPence: number; recipientName: string; redeemed: boolean }>;
}

export function fetchShopperAccount(key: string, id: string): Promise<ShopperAccountView> {
  return staffRequest(key, `/staff/shoppers/${encodeURIComponent(id)}`);
}

/** Everything held about a Shopper, as a CSV file to save: a link to it. */
export function shopperExportLink(key: string, id: string): Promise<string> {
  return fetchStaffFile(key, `/staff/shoppers/${encodeURIComponent(id)}/export.csv`);
}

export interface AuditEntryRow {
  id: string;
  at: string;
  actorId: string | null;
  actorName: string;
  actorRole: string;
  action: string;
  words: string;
  target: string;
  detail: string;
  ip: string;
}

export function fetchAuditLog(
  key: string,
  filters: { search?: string; from?: string; to?: string } = {},
): Promise<{ entries: AuditEntryRow[] }> {
  return staffRequest(key, `/staff/audit${query(filters)}`);
}

/* ------------------------------------------------------------------------------------- *
 * Booked orders (ruling 78): ordered now for a later day
 * ------------------------------------------------------------------------------------- */

export interface BookedOrder {
  id: string;
  reference: string;
  status: string;
  deliveryDay: string;
  deliveryWindow: 'morning' | 'afternoon' | 'evening' | null;
  /** "Saturday 31 October, in the morning, 8:00 to 12:00". */
  deliveryWords: string;
  chargePlan: 'now' | 'scheduled' | 'bank' | null;
  chargeAt: string | null;
  /** "on Sunday 1 November at 00:05", "now", or "by bank transfer by Friday 30 October". */
  chargeWords: string;
  chargeStatus: 'waiting' | 'retrying' | 'needs_authentication' | 'failed' | 'paid' | null;
  paid: boolean;
  held: boolean;
  bankReference: string | null;
  totalPence: number;
  items: Array<{ name: string; quantity: number }>;
  canChange: boolean;
  canChangePayment: boolean;
  canCancel: boolean;
}

export function fetchBookedOrders(): Promise<{ orders: BookedOrder[] }> {
  return request<{ orders: BookedOrder[] }>('/orders/booked');
}

export function changeBookedOrder(
  id: string,
  change: {
    deliveryDay?: string;
    window?: 'morning' | 'afternoon' | 'evening';
    chargeDay?: string;
    chargeTime?: string;
  },
): Promise<{ order: BookedOrder; message: string }> {
  return request(`/orders/${encodeURIComponent(id)}/booking`, {
    method: 'POST',
    body: JSON.stringify(change),
  });
}

export function cancelBookedOrder(
  id: string,
): Promise<{ order: BookedOrder; refundedPence: number; message: string }> {
  return request(`/orders/${encodeURIComponent(id)}/booking/cancel`, { method: 'POST' });
}

/** What a Runner sees of tomorrow: how many are booked, by window, and nothing about anybody. */
export interface BookedTomorrow {
  day: string;
  total: number;
  morning: number;
  afternoon: number;
  evening: number;
}

export function fetchBookedTomorrow(): Promise<BookedTomorrow> {
  return request<BookedTomorrow>('/runner/booked', undefined, 'runner');
}

/** "Pay us by bank": the business account and a reference of the account's own. */
export type PayByBank =
  | {
      enabled: true;
      accountName: string;
      sortCode: string;
      accountNumber: string;
      reference: string;
    }
  | { enabled: false; message: string };

export function fetchPayByBank(as: 'shopper' | 'business'): Promise<PayByBank> {
  return as === 'business'
    ? businessRequest<PayByBank>('/business/pay-by-bank')
    : request<PayByBank>('/pay-by-bank');
}
