/**
 * The audit log (Section Q, docs/SECURITY_PROPOSAL.md): every change made in the admin panel,
 * with who made it, what it was, what it was made to, when, and from which internet address.
 * It exists so a dispute between staff can be settled, and so the business can answer the
 * Information Commissioner if a Shopper asks who opened their record.
 *
 * Changes are written down by one hook for every route, so a new admin route cannot forget:
 * any request that is not a plain look (GET), made by someone the admin panel has checked,
 * that succeeded. Looks that matter in law, such as opening a Shopper's account or exporting
 * their data, are written down by the route itself with `recordAudit`.
 *
 * Since ruling 97 (5 November 2026) the same hook writes down what a Runner does with their
 * sign-in and what a Shop Partner does with its business sign-in: the actor is the Runner by first
 * name and Runner ID, or the shop by name and Partner ID, in the same table. Shoppers' actions
 * stay unaudited, apart from the sensitive ones a route records itself; what anybody says to Ozi
 * is a conversation, kept by Ozi's memory (ruling 68), never here.
 *
 * The log is only ever added to. The repository has no way to change or remove an entry, and
 * the database refuses to as well (migration 20261017090000_admin_audit_and_two_step).
 * Writing an entry never undoes what was done; if it cannot be written, the server log says so.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

import { verifyBusinessToken } from './business.js';
import { ensurePublicId, firstNameOf } from '../services/public-ids.js';

/** Anything with one of these in its name is never written down, only that it was given. */
const SECRET = /password|passcode|code|secret|token|key|current/i;
const DETAIL_LIMIT = 500;

/** What was sent, as short text, with every password, passcode and code taken out. */
export function redactedDetail(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body) || Buffer.isBuffer(body)) {
    return '';
  }
  const tidy = Object.fromEntries(
    Object.entries(body as Record<string, unknown>).map(([name, value]) => [
      name,
      SECRET.test(name)
        ? '[hidden]'
        : typeof value === 'string' && value.length > 120
          ? `${value.slice(0, 120)}…`
          : value,
    ]),
  );
  const text = JSON.stringify(tidy);
  if (text === '{}') return '';
  return text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT)}…` : text;
}

/** The route as written, such as POST /staff/problems/:id/decide, without the /api prefix. */
export function routeName(request: FastifyRequest): string {
  const url = (request.routeOptions.url ?? request.url.split('?')[0] ?? '').replace(
    /^\/api(?=\/)/,
    '',
  );
  return `${request.method} ${url}`;
}

/** What the change was made to: the ids in the address, such as an order or a report. */
function targetOf(request: FastifyRequest): string {
  const params = request.params as Record<string, unknown> | undefined;
  if (!params) return '';
  return Object.entries(params)
    .filter(([, value]) => typeof value === 'string' && value !== '')
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(' ');
}

/** Writes one entry. Never throws: what was done stays done. */
export async function recordAudit(
  request: FastifyRequest,
  entry: {
    actor?: { id: string | null; name: string; role: string } | null;
    action: string;
    target?: string;
    detail?: string;
  },
): Promise<void> {
  const actor = entry.actor ?? request.staffActor;
  if (!actor) return;
  const { repository, now } = request.server.ctx;
  try {
    await repository.audit.record({
      at: now(),
      actorId: actor.id,
      actorName: actor.id === null ? `${actor.name} (staff key)` : actor.name,
      actorRole: actor.role,
      action: entry.action,
      target: entry.target ?? '',
      detail: entry.detail ?? '',
      ip: request.ip ?? '',
    });
    (request as FastifyRequest & { audited?: boolean }).audited = true;
  } catch (failure) {
    request.log.error(
      { err: failure, action: entry.action },
      'The audit log could not be written.',
    );
  }
}

const LOOKING = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Asked with a staff sign-in but changing nothing: what someone says to Ozi in the panel is a
 * conversation, not an action, and is never written down here.
 */
const NOT_CHANGES = new Set([
  'POST /ozi/reply',
  // Ozi reading a matter on its call in the app, and the call ending (ruling 79).
  'POST /staff/desk/:id/read',
  'POST /staff/desk/ring/:id/end',
  // A Runner's phone saying where it is, every few seconds: a heartbeat, not an action.
  'POST /runners/me/location',
]);

/**
 * Who a change is from when it is not staff (ruling 97): a Runner by their sign-in, named by
 * first name and Runner ID; a Shop Partner by its business sign-in, named by shop and Partner ID.
 * A Shopper, an organisation or nobody signed in gives null: not written down here.
 */
async function otherActor(
  request: FastifyRequest,
): Promise<{ id: string; name: string; role: string } | null> {
  const ctx = request.server.ctx;
  if (request.session?.role === 'runner') {
    const runner = await ctx.repository.runners.findById(request.session.accountId);
    if (!runner) return null;
    return {
      id: runner.id,
      name: `${firstNameOf(runner.name)} (${runner.referralCode})`,
      role: 'runner',
    };
  }
  if (request.session) return null;
  const given = request.headers['x-business-token'];
  const token = Array.isArray(given) ? given[0] : given;
  const userId = token ? verifyBusinessToken(token, ctx.env.authTokenSecret, ctx.now()) : null;
  const user = userId ? await ctx.repository.businessUsers.findById(userId) : null;
  if (!user?.partnerShopId) return null;
  const shop = await ctx.repository.partnerShops.findById(user.partnerShopId);
  if (!shop) return null;
  const publicId = await ensurePublicId(ctx, 'partner', shop).catch(() => shop.publicId ?? '');
  return { id: shop.id, name: `${shop.name} (${publicId})`, role: 'partner' };
}

/**
 * The hook: every successful change by someone the admin panel checked. Runs as the reply is
 * sent, when its status is known.
 */
export async function auditChange(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (LOOKING.has(request.method)) return;
  if (reply.statusCode >= 400) return;
  if ((request as FastifyRequest & { audited?: boolean }).audited) return;
  const action = routeName(request);
  if (NOT_CHANGES.has(action)) return;
  let actor: { id: string | null; name: string; role: string } | null = request.staffActor ?? null;
  if (!actor) {
    try {
      actor = await otherActor(request);
    } catch (failure) {
      request.log.warn({ err: failure }, 'The audit log could not tell who made a change.');
    }
    if (!actor) return;
  }
  await recordAudit(request, {
    actor,
    action,
    target: targetOf(request),
    detail: redactedDetail(request.body),
  });
}

/**
 * Plain words for what each change was, so the log reads well aloud and on the screen. Anything
 * not named here is shown as the route itself.
 */
export const AUDIT_WORDS: Record<string, string> = {
  'staff.signed-in': 'Signed in',
  'staff.sign-in-refused': 'A sign-in was refused',
  'shopper.opened': "Opened a Shopper's account",
  'shopper.searched': 'Searched for a Shopper',
  'shopper.exported': "Exported a Shopper's data",
  'POST /staff/password': 'Changed their own password',
  'POST /staff/desk/ring/:id/answer': "Answered Ozi's call in the app",
  'POST /staff/desk/ring/:id/not-now': "Said not now to Ozi's call in the app",
  'POST /staff/desk/test-call': "Tested Ozi's call",
  'POST /staff/push-subscriptions': 'Let Ozi ring them in the app on a device',
  'DELETE /staff/push-subscriptions': 'Stopped Ozi ringing them on a device',
  'POST /staff/team': 'Added someone to the team',
  'POST /staff/team/:id': "Changed someone's job or turned their account on or off",
  'POST /staff/team/:id/reset': "Reset someone's password",
  // The owner's own controls (ruling 85), in the panel or by voice.
  'staff.switched-off': 'Switched a staff account off, signing it out everywhere',
  'staff.switched-on': 'Switched a staff account back on',
  'staff.all-switched-off': 'Switched off every staff account except the owner',
  'owner.alerts-changed': 'Changed how Ozi reaches the owner',
  'email.marked-heard': 'Marked emails as heard',
  'email.replied': 'Replied to an email by voice',
  // An Ambassador's link in the owner's and staff's hands, and an individual rate (ruling 94).
  'ambassadors.link-texted': "Texted an Ambassador's business sign-up link to a business",
  'ambassadors.rate-set': "Set an Ambassador's individual rate",
  // Unlocking anybody, and resetting a PIN or a password (ruling 81).
  'unlock.staff-password-reset': 'Gave a staff member a temporary password',
  'unlock.shopper-pin': "Unlocked a Shopper's PIN",
  'unlock.shopper-pin-reset': "Reset a Shopper's PIN",
  'unlock.staff': 'Unlocked a staff member',
  'unlock.sign-in-codes': "Cleared the limits on sign-in codes for an account's phone",
  'unlock.searched': 'Looked for someone to unlock',
  'POST /staff/team/:id/can-unlock': 'Let someone unlock people, or stopped it',
  'POST /staff/team/:id/two-step-reset': "Reset someone's two-step codes",
  'POST /staff/owner': "Made the owner's account",
  'POST /staff/owner/passcode': 'Changed the passcode',
  'POST /staff/owner/kill-switch': 'Used the kill switch',
  'POST /staff/two-step/start': 'Started setting up two-step codes',
  'POST /staff/two-step/confirm': 'Switched two-step codes on',
  'POST /staff/two-step/off': 'Switched two-step codes off',
  'POST /staff/two-step/recovery-codes': 'Made new recovery codes',
  'POST /staff/owner/two-step/start': 'Started setting up two-step codes',
  'POST /staff/owner/two-step/confirm': 'Switched two-step codes on',
  'POST /staff/owner/two-step/off': 'Switched two-step codes off',
  'POST /staff/viewers': 'Added a family member or investor',
  'POST /staff/viewers/:id': 'Changed what a family member or investor sees',
  'POST /staff/problems/:id/decide': 'Decided a complaint',
  'POST /staff/documents/:id/review': 'Checked a Runner document',
  'POST /staff/runners/:id/write-off': 'Wrote off what a Runner owed',
  'POST /staff/find-it/:id/decide': 'Decided a Finds It request',
  'POST /staff/enquiries/:id/handled': 'Marked an enquiry as rung back',
  'POST /staff/learning/:id': 'Decided an answer for Ozi to learn',
  'POST /staff/partners': 'Added a shop from a paper form',
  'POST /staff/partners/:id': 'Changed a shop (approved, paused, removed or a payment recorded)',
  'POST /staff/partners/:id/users': 'Added a sign-in for a shop',
  'POST /staff/partners/seed': 'Added the seed shops Ozi lists itself',
  'POST /staff/partner-products/:id/decide': 'Decided a shop product or service',
  'POST /staff/organisations': 'Added an organisation',
  'POST /staff/organisations/:id/users': 'Added a sign-in for an organisation',
  'POST /staff/payments/:orderId/received': 'Marked a bank transfer as received',
  'POST /staff/payments/:orderId/cancel': 'Cancelled a bank transfer order',
  'POST /staff/reimbursements/:orderId/approve': 'Approved paying a Runner back',
  'POST /staff/orders/:id/cancel': 'Cancelled an order and sent the money back',
  'POST /staff/orders/:id/goodwill': 'Gave a goodwill refund',
  'POST /staff/orders/:id/reassign': 'Gave an order to another Runner',
  // Ozi's desk and the automatic check (ruling 74).
  'owner-desk.decided': 'Decided something Ozi rang about',
  'owner-desk.later': 'Put something Ozi rang about to later',
  'automatic-check': 'The automatic check',
  'POST /runners/me/face-match-consent': 'Agreed to, or withdrew, the face comparison',
  // The company inbox and staff calls (ruling 77).
  'inbox.sent': 'Sent a message to an account',
  'inbox.asked': 'Asked the owner to approve a message',
  'inbox.approved': 'Approved a staff message on the desk',
  'inbox.refused': 'A message was refused: no valid code',
  'inbox.read': 'Read an account’s messages',
  'contact.code-issued': 'Issued a message or call code',
  'contact.call-code-entered': 'Entered the day’s call code',
  'call.started': 'Called an account',
  'call.phone': 'Rang an account’s phone',
  'call.ended': 'Ended a call',
  'call.recording-played': 'Played a call recording',
  'POST /staff/team/:id/authorise': 'Let someone authorise messages and calls, or stopped it',
  // Sending jobs straight to a chosen Runner (ruling 80).
  'order.allocated': 'Sent an order straight to a Runner',
  'order.auto-cancelled': 'Cancelled an order no Runner took, with a full refund',
  'referrals.voucher-opened': 'Opened a sent voucher, with its code',
  'referrals.voucher-sent': 'Sent a referral voucher',
  'POST /staff/orders/allocate': 'Tried to send orders straight to Runners',
  'POST /staff/team/:id/allocate': 'Let someone send jobs straight to Runners, or stopped it',
};

/** Runners' and Shop Partners' own actions (ruling 97), in plain words. */
Object.assign(AUDIT_WORDS, {
  'partner.order-ready': 'A shop said an order was ready for pickup',
  'partner.message': 'A shop sent its Runner a set message',
  'partner.call-started': 'A shop called its Runner in the app',
  'POST /jobs/:offerId/accept': 'Took a job',
  'POST /jobs/:offerId/decline': 'Said no to a job',
  'POST /orders/:id/status': 'Moved an order on',
  'POST /orders/:id/receipt': 'Put in the till total',
  'POST /orders/:orderId/calls': 'Started a call about an order',
  'POST /calls/:callId/join': 'Answered a call',
  'POST /calls/:callId/end': 'Ended a call',
  'POST /runners/me/availability': 'Went on or off shift',
  'POST /runners/me/travel-mode': 'Changed how they are travelling',
  'POST /partner/terms/agree': 'Agreed to the Shop Partner terms',
  'POST /partner/profile': 'Changed how Shoppers find the shop',
  'POST /partner/products': 'Added a product',
  'POST /partner/products/:id/price': 'Changed a price',
  'POST /partner/products/:id/remove': 'Took a product off',
});

export function auditWords(action: string): string {
  return AUDIT_WORDS[action] ?? action;
}
