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
  return request<{ shopper: Shopper; token: string }>('/shoppers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
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
export function updateMe(patch: Partial<RegisterShopperInput>): Promise<{ shopper: Shopper }> {
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
  items: Array<{ id: string; name: string; quantity: number }>;
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

function staffRequest<T>(key: string, path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, { ...init, headers: { 'x-staff-key': key } });
}

export function checkStaffKey(key: string): Promise<{ ok: true }> {
  return staffRequest(key, '/staff/check');
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
  const response = await fetch(`${BASE_URL}${path}`, { headers: { 'x-staff-key': key } });
  if (!response.ok)
    throw new ApiError('That file could not be opened.', response.status, undefined);
  return URL.createObjectURL(await response.blob());
}
