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
 * The log is only ever added to. The repository has no way to change or remove an entry, and
 * the database refuses to as well (migration 20261017090000_admin_audit_and_two_step).
 * Writing an entry never undoes what was done; if it cannot be written, the server log says so.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

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
const NOT_CHANGES = new Set(['POST /ozi/reply']);

/**
 * The hook: every successful change by someone the admin panel checked. Runs as the reply is
 * sent, when its status is known.
 */
export async function auditChange(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.staffActor || LOOKING.has(request.method)) return;
  if (reply.statusCode >= 400) return;
  if ((request as FastifyRequest & { audited?: boolean }).audited) return;
  const action = routeName(request);
  if (NOT_CHANGES.has(action)) return;
  await recordAudit(request, {
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
  'POST /staff/team': 'Added someone to the team',
  'POST /staff/team/:id': "Changed someone's job or turned their account on or off",
  'POST /staff/team/:id/reset': "Reset someone's password",
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
  'POST /staff/partners': 'Added a Shop Partner',
  'POST /staff/partners/:id': 'Changed a Shop Partner',
  'POST /staff/partners/:id/users': 'Added a sign-in for a Shop Partner',
  'POST /staff/partner-products/:id/decide': 'Decided a shop product',
  'POST /staff/organisations': 'Added an organisation',
  'POST /staff/organisations/:id/users': 'Added a sign-in for an organisation',
  'POST /staff/payments/:orderId/received': 'Marked a bank transfer as received',
  'POST /staff/payments/:orderId/cancel': 'Cancelled a bank transfer order',
  'POST /staff/reimbursements/:orderId/approve': 'Approved paying a Runner back',
};

export function auditWords(action: string): string {
  return AUDIT_WORDS[action] ?? action;
}
