/**
 * The Runner's SOS button (docs/BUILD_PROMPT.md, Section M): "A lone Runner going to a stranger's
 * door currently has nothing."
 *
 * Pressing it (after a second press to confirm, so a pocket cannot do it) does three things:
 *
 * - writes down where the Runner is, from their phone, and keeps it up to date while it is on;
 * - texts the owner's alert phone (OWNER_ALERT_PHONE) the Runner's name, their own number, the
 *   job's reference and area, and a private link to a page on our own server showing where they
 *   are now. The link carries a long random code, of which only a hash is kept, and it stops
 *   working when the SOS has been over for an hour, or after `runners.sosLinkHours` at most;
 * - shows the Runner what to do: call 999 if they are in danger.
 *
 * Staff see every SOS still on in the admin panel's Problems tab, and can mark one over.
 *
 * No Shopper's telephone number is ever part of it, and nothing is sent to the Shopper.
 */

import { createHash, randomBytes } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { AppContext } from '../app.js';
import type { Order, Runner, RunnerSos } from '../domain.js';
import { areaOf, orderReference } from '../routes/runner-account.js';

type SosContext = Pick<AppContext, 'repository' | 'config' | 'env' | 'now' | 'sendText'>;

/** What the Runner is told, every time: the emergency services come first. */
export const CALL_999 =
  'If you are in danger, call 999 now. Get somewhere safe and public if you can. We have been told where you are.';

/** How long the link keeps working once the SOS is over. */
const LINK_AFTER_END_MS = 60 * 60 * 1000;

export interface Whereabouts {
  latitude: number;
  longitude: number;
  accuracyMetres?: number | undefined;
}

export function hashLinkCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** The job a Runner has in hand now, if any. */
async function jobInHand(ctx: SosContext, runnerId: string): Promise<Order | null> {
  for (const status of ['accepted', 'shopping', 'receipt_submitted', 'delivering'] as const) {
    const order = (await ctx.repository.orders.listByStatus(status)).find(
      (candidate) => candidate.runnerId === runnerId,
    );
    if (order) return order;
  }
  return null;
}

/** The private page showing where the Runner is: on our own server, under /api. */
export function sosLink(ctx: Pick<AppContext, 'env'>, code: string): string {
  return `${ctx.env.primaryOrigin ?? ''}/api/sos/${code}`;
}

/** The text to the owner. Short, because it is read on a phone in a hurry. */
export function sosText(input: {
  productName: string;
  runner: Pick<Runner, 'name' | 'phone' | 'referralCode'>;
  order: Pick<Order, 'id' | 'deliveryAddress'> | null;
  link: string;
  located: boolean;
}): string {
  const job = input.order
    ? ` On order ${orderReference(input.order.id)}, area ${areaOf(input.order.deliveryAddress)}.`
    : ' Not on a job.';
  return [
    `${input.productName} SOS: Runner ${input.runner.name} (${input.runner.referralCode}) pressed SOS.${job}`,
    `Ring them on ${input.runner.phone}. If you cannot reach them, call 999.`,
    input.located
      ? `Where they are now: ${input.link}`
      : `Their phone has not shared where they are yet. This link will show it when it does: ${input.link}`,
  ].join('\n');
}

/**
 * Start an SOS, or carry on with the one already on: a second press never sends a second text,
 * it only brings the location up to date.
 */
export async function startSos(
  ctx: SosContext,
  runner: Runner,
  where: Whereabouts | null,
  log?: FastifyBaseLogger,
): Promise<{ sos: RunnerSos; alreadyOn: boolean; alerted: boolean }> {
  const at = ctx.now();
  const existing = await ctx.repository.sos.findActiveForRunner(runner.id);
  if (existing) {
    const sos = where ? await updateSosLocation(ctx, existing, where) : existing;
    return { sos, alreadyOn: true, alerted: existing.alertSentAt !== null };
  }

  const order = await jobInHand(ctx, runner.id);
  const code = randomBytes(24).toString('base64url');
  let sos = await ctx.repository.sos.create({
    runnerId: runner.id,
    orderId: order?.id ?? null,
    startedAt: at,
    endedAt: null,
    endedBy: null,
    latitude: where?.latitude ?? null,
    longitude: where?.longitude ?? null,
    accuracyMetres: where?.accuracyMetres ?? null,
    locationAt: where ? at : null,
    linkCodeHash: hashLinkCode(code),
    linkExpiresAt: new Date(at.getTime() + ctx.config.runners.sosLinkHours * 3600 * 1000),
    alertSentAt: null,
    alertProblem: null,
  });

  let alerted = false;
  if (!ctx.env.ownerAlertPhone || !ctx.sendText) {
    sos = await ctx.repository.sos.update(sos.id, {
      alertProblem: 'No alert phone is set up (OWNER_ALERT_PHONE and Twilio).',
    });
    log?.error({ sosId: sos.id }, 'A Runner pressed SOS and nobody could be texted.');
  } else {
    try {
      await ctx.sendText(
        ctx.env.ownerAlertPhone,
        sosText({
          productName: ctx.config.productName,
          runner,
          order,
          link: sosLink(ctx, code),
          located: where !== null,
        }),
      );
      sos = await ctx.repository.sos.update(sos.id, { alertSentAt: ctx.now() });
      alerted = true;
    } catch (failure) {
      log?.error({ err: failure, sosId: sos.id }, 'The SOS text could not be sent.');
      sos = await ctx.repository.sos.update(sos.id, {
        alertProblem: 'The text to the alert phone did not go.',
      });
    }
  }
  return { sos, alreadyOn: false, alerted };
}

export async function updateSosLocation(
  ctx: SosContext,
  sos: RunnerSos,
  where: Whereabouts,
): Promise<RunnerSos> {
  return ctx.repository.sos.update(sos.id, {
    latitude: where.latitude,
    longitude: where.longitude,
    accuracyMetres: where.accuracyMetres ?? null,
    locationAt: ctx.now(),
  });
}

/** Over: the Runner is safe, or a person has dealt with it. The link stops an hour later. */
export async function endSos(ctx: SosContext, sos: RunnerSos, by: string): Promise<RunnerSos> {
  const at = ctx.now();
  const stop = new Date(Math.min(sos.linkExpiresAt.getTime(), at.getTime() + LINK_AFTER_END_MS));
  return ctx.repository.sos.update(sos.id, { endedAt: at, endedBy: by, linkExpiresAt: stop });
}

/** A maps address for a point: opens the phone's own maps on most phones. */
export function mapsLink(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude.toFixed(6)},${longitude.toFixed(6)}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The page behind the private link: plain HTML, no script, large type, reloading itself every
 * twenty seconds while the SOS is on. Everything on it is escaped.
 */
export function sosPage(input: {
  productName: string;
  runnerName: string;
  sos: RunnerSos;
  at: Date;
}): string {
  const { sos } = input;
  const on = sos.endedAt === null;
  const time = (when: Date): string =>
    when.toLocaleTimeString('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
    });
  const located = sos.latitude !== null && sos.longitude !== null;
  const lines: string[] = [
    `<h1>${escapeHtml(input.runnerName)} pressed SOS at ${time(sos.startedAt)}</h1>`,
    on
      ? '<p><strong>It is still on.</strong> If you cannot reach them, call 999.</p>'
      : `<p>It was marked over at ${time(sos.endedAt as Date)}${sos.endedBy ? ` by ${escapeHtml(sos.endedBy)}` : ''}.</p>`,
  ];
  if (located) {
    const lat = sos.latitude as number;
    const lng = sos.longitude as number;
    lines.push(
      `<p>Last known place, at ${time(sos.locationAt ?? sos.startedAt)}${
        sos.accuracyMetres !== null
          ? `, to within about ${Math.round(sos.accuracyMetres)} metres`
          : ''
      }: ${lat.toFixed(5)}, ${lng.toFixed(5)}.</p>`,
      `<p><a href="${escapeHtml(mapsLink(lat, lng))}">Open it in maps</a></p>`,
    );
  } else {
    lines.push(
      '<p>Their phone has not shared where they are yet. This page checks again by itself.</p>',
    );
  }
  lines.push(
    `<p>This private page stops working at ${time(sos.linkExpiresAt)}. Do not share it.</p>`,
  );
  return [
    '<!doctype html>',
    '<html lang="en-GB">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    on ? '<meta http-equiv="refresh" content="20">' : '',
    `<title>SOS: ${escapeHtml(input.productName)}</title>`,
    '<style>body{font-family:system-ui,sans-serif;font-size:20px;line-height:1.5;margin:16px;background:#fff;color:#000}a{color:#00e;font-size:24px}</style>',
    '</head>',
    '<body>',
    ...lines,
    '</body>',
    '</html>',
  ]
    .filter(Boolean)
    .join('\n');
}
