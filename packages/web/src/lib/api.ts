/**
 * Talking to the API.
 *
 * The shell works without it: every screen has something sensible to show when the server
 * is not running, and says so in plain words rather than spinning forever or showing a
 * stack trace.
 */

import { storeConfig } from '../config';
import { readRunnerToken, readToken } from './session';

export interface CatalogueItem {
  id: string;
  name: string;
  category: string;
  estimatedPricePence: number;
}

export interface CatalogueResult {
  items: CatalogueItem[];
  attribution: string;
  source: string;
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
  constructor(readonly reason = 'no answer') {
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

async function request<T>(
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
  } catch {
    throw new ApiUnavailableError();
  }

  if (isNotJson(response)) {
    throw new ApiUnavailableError('the reply was not JSON');
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    // A body that will not parse is not an empty body. Saying so is the whole point.
    if (response.ok) throw new ApiUnavailableError('the reply could not be read');
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

export interface BasketPrice {
  goodsEstimatePence: number;
  feePence: number;
  totalPence: number;
  explanation: string[];
}

export function priceBasketRemotely(
  lines: Array<{ catalogueItemId: string; quantity: number }>,
): Promise<BasketPrice> {
  return request<BasketPrice>('/basket/price', {
    method: 'POST',
    body: JSON.stringify({ lines }),
  });
}

/* ------------------------------------------------------------------------------------- *
 * The account
 * ------------------------------------------------------------------------------------- */

export type SubstitutionChoice = 'no_substitutes' | 'similar_item' | 'ask_me';

export interface Shopper {
  id: string;
  /** Ozi Recipes is unlocked until then (ISO date), or never bought. */
  recipePassUntil?: string | null;
  plusUntil?: string | null;
  creditPence?: number;
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
}

export interface RegisterShopperInput {
  displayName: string;
  phone: string;
  deliveryAddress: string;
  doorstepProtocol?: string;
  substitutionDefault?: SubstitutionChoice;
  /** From verifying the code sent to the number, once numbers are confirmed at sign-up. */
  phoneProof?: string;
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
  });
}

const JOINED_VIA = 'ozidelivery.joined.via';

/** Remembers which share link brought someone here: partner:<id> or organisation:<id>. */
export function rememberJoinedVia(via: string): void {
  try {
    window.localStorage.setItem(JOINED_VIA, via);
  } catch {
    // Not counted, which is harmless.
  }
}

function joinedVia(): string | null {
  try {
    return window.localStorage.getItem(JOINED_VIA);
  } catch {
    return null;
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

export function requestSignInCode(
  phone: string,
  options: { channel?: 'text' | 'call'; purpose?: 'sign-in' | 'sign-up' } = {},
): Promise<{ message: string }> {
  return request<{ message: string }>('/auth/request-code', {
    method: 'POST',
    body: JSON.stringify({
      phone,
      role: 'shopper',
      channel: options.channel ?? 'text',
      purpose: options.purpose ?? 'sign-in',
    }),
  });
}

export type SignInResult =
  | { registrationRequired: false; token: string }
  | { registrationRequired: true; phone: string; message: string; phoneProof?: string };

export function verifySignInCode(phone: string, code: string): Promise<SignInResult> {
  return request<SignInResult>('/auth/verify-code', {
    method: 'POST',
    body: JSON.stringify({ phone, code, role: 'shopper' }),
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
}

/**
 * Signing up to run. The token that comes back is kept as the Runner's, separately from any
 * Shopper signed in on the same browser — see `readRunnerToken`.
 */
export function registerRunner(
  input: RegisterRunnerInput,
): Promise<{ runner: { name: string; phone: string; referralCode: string }; token: string }> {
  return request<{ runner: { name: string; phone: string; referralCode: string }; token: string }>(
    '/runners',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
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
  sentAs: 'photo' | 'share code';
  createdAt: string;
}

export interface RunnerDocuments {
  documents: RunnerDocumentRecord[];
  stillNeeded: Array<{ kind: RunnerDocumentKind; name: string }>;
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
  /** Owed after a decision against them: every one, its reason, and what is left. */
  owing?: Array<{
    reference: string;
    amountPence: number;
    recoveredPence: number;
    remainingPence: number;
    reason: string;
  }>;
  recoveryPercentOfPay?: number;
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

export interface OfferedJob {
  offer: { id: string };
  secondsLeft: number;
  job: {
    itemCount: number;
    goodsEstimatePence: number;
    runnerPaymentPence: number;
    distanceMiles: number | null;
  } | null;
}

export function fetchOfferedJobs(): Promise<{ offers: OfferedJob[] }> {
  return request<{ offers: OfferedJob[] }>('/jobs/mine', undefined, 'runner');
}

export function acceptJob(offerId: string): Promise<unknown> {
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
  goodsEstimatePence: number;
  receiptTotalPence: number | null;
  runnerPaymentPence: number;
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

export function submitTillTotal(
  orderId: string,
  receiptTotalPence: number,
): Promise<{ message: string }> {
  return request<{ message: string }>(
    `/orders/${encodeURIComponent(orderId)}/receipt`,
    { method: 'POST', body: JSON.stringify({ receiptTotalPence }) },
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
  payment: {
    id: string;
    status: string;
    clientSecret: string | null;
    requiresAction: boolean;
  };
  message: string;
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
  paymentMethodId: string;
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
      paymentMethodId: input.paymentMethodId,
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

export function fetchCallsConfig(): Promise<CallsConfig> {
  return request<{ calls?: CallsConfig }>('/config').then(
    (body) => body.calls ?? { enabled: false, pencePerMinute: 5 },
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

function staffRequest<T>(key: string, path: string, init?: RequestInit): Promise<T> {
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
  | 'team';

export interface StaffSignedIn {
  token: string;
  name: string;
  role: string;
  title: string;
  areas: StaffArea[];
  mustChangePassword: boolean;
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
    viewOnly?: boolean;
    totpEnabled?: boolean;
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
  sentAs: 'share code' | 'photo';
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

export interface PlusState {
  active: boolean;
  plusUntil: string | null;
  family: boolean;
  familyCode: string | null;
  members: string[];
  joinedFamilyOf: string | null;
  familyMaximum: number;
  creditPence: number;
}

export function fetchPlus(): Promise<PlusState> {
  return request<PlusState>('/extras/plus');
}

export function buyPlus(plan: 'single' | 'family'): Promise<PlusState & { message: string }> {
  return request('/extras/plus', {
    method: 'POST',
    body: JSON.stringify({ plan, priceAccepted: true }),
  });
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
}

export function fetchWeeklyShops(): Promise<{ sets: WeeklyShop[] }> {
  return request('/sets');
}

export function bookWeeklyShop(input: {
  dayOfWeek: number;
  deliveryAddress: string;
  lines: Array<{ catalogueItemId: string; quantity: number }>;
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
  organisation: string;
  contactName: string;
  telephone: string;
  email: string;
  people: string;
  message: string;
}): Promise<{ message: string }> {
  return request('/organisations/enquiries', { method: 'POST', body: JSON.stringify(input) });
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
}

export interface PartnerDashboard extends PartnerExtras {
  shop: { id: string; name: string; address: string; telephone: string; about: string };
  plan: { monthlyPence: number; paidUntil: string | null; paid: boolean };
  counts: { live: number; waiting: number; notAccepted: number };
  products: PartnerProductRow[];
  sharePath: string;
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
  products: number;
}

export function fetchShops(): Promise<{ shops: PublicShop[] }> {
  return request('/shops');
}

export interface PublicShopProduct {
  id: string;
  name: string;
  pricePence: number;
  tags: string;
  expiresOn: string | null;
  hasPhoto: boolean;
  catalogueItemId: string | null;
}

export function fetchShop(id: string): Promise<{
  shop: { id: string; name: string; about: string; address: string };
  products: PublicShopProduct[];
}> {
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
  people: Array<{ id: string; name: string; office: string }>;
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
  deliveryFeePence: number;
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

export function joinOrganisation(
  code: string,
): Promise<{ organisation: { name: string }; message: string }> {
  return request('/me/organisation', {
    method: 'POST',
    body: JSON.stringify({ code, agreed: true }),
  });
}

export function leaveOrganisation(): Promise<{ message: string }> {
  return request('/me/organisation/leave', { method: 'POST', body: JSON.stringify({}) });
}

export interface StaffPartners {
  shops: Array<{
    id: string;
    name: string;
    monthlyPence: number;
    paidUntil: string | null;
    paid: boolean;
    active: boolean;
    spotlightActive: boolean;
    live: number;
    waiting: number;
    users: Array<{ id: string; name: string; username: string }>;
  }>;
  organisations: Array<{
    id: string;
    name: string;
    joinCode: string | null;
    people: number;
    users: Array<{ id: string; name: string; username: string; office: string }>;
  }>;
  partnerMonthlyPence: number;
  spotlightPence: number;
  spotlightPlusPence: number;
}

export function fetchStaffPartners(key: string): Promise<StaffPartners> {
  return staffRequest(key, '/staff/partners');
}

export function addStaffPartner(
  key: string,
  input: { name: string; address: string; telephone: string; about: string; paidMonths: number },
): Promise<unknown> {
  return staffRequest(key, '/staff/partners', { method: 'POST', body: JSON.stringify(input) });
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

export interface StaffOverview {
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

export function confirmTwoStep(key: string, code: string): Promise<{ message: string }> {
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
