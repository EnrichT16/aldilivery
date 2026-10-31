/**
 * How Ozi reaches the owner (Anthony, 31 October 2026, ruling 85): for each kind of matter, a
 * call, a text, a notification on his devices, or nothing; and his quiet hours. He chooses by
 * voice (read back, then his yes) or in My settings. The defaults are `ownerAlerts` and the
 * `ownerDesk` quiet hours in config/store.json; his own choice is one row in the database.
 *
 * Urgent safety always calls, even in quiet hours: it cannot be changed. The owner's desk
 * (services/owner-desk.ts) and the email desk (services/email-desk.ts) obey the rest.
 */

import { ALERT_KINDS, ALERT_WAYS, type AlertKind, type AlertWay } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { OwnerMatter, OwnerMatterKind, OwnerPreference } from '../domain.js';
import { BadRequestError } from '../errors.js';

export type PreferenceContext = Pick<AppContext, 'repository' | 'config' | 'now'>;

/** What the owner may change: any kind but urgent safety, and the quiet hours. */
export type AlertChanges = Partial<Record<Exclude<AlertKind, 'urgentSafety'>, AlertWay>> & {
  quietFrom?: string;
  quietUntil?: string;
};

export interface AlertPreferences {
  ways: Record<AlertKind, AlertWay>;
  quietFrom: string;
  quietUntil: string;
  /** Null until he first changes anything: the defaults from configuration. */
  updatedAt: Date | null;
  updatedBy: string | null;
}

/** Each kind of matter in words, said and shown. */
export const ALERT_KIND_WORDS: Record<AlertKind, string> = {
  urgentSafety: 'urgent safety, such as a Runner pressing SOS',
  importantEmail: 'important emails',
  otherEmail: 'other emails',
  approvals: 'Runner and partner approvals',
  money: 'money',
};

/** Each way in words: "I ring you", "a text", "a notification", "nothing". */
export const ALERT_WAY_WORDS: Record<AlertWay, string> = {
  call: 'a call',
  text: 'a text',
  notification: 'a notification on your devices',
  none: 'nothing, only the Needs you now page',
};

/** The owner's choices now: his own row, or the configured defaults. */
export async function alertPreferences(ctx: PreferenceContext): Promise<AlertPreferences> {
  const defaults = ctx.config.ownerAlerts;
  const kept = await ctx.repository.ownerPreferences.get().catch(() => null);
  const ways = Object.fromEntries(
    ALERT_KINDS.map((kind) => {
      const chosen = kept?.[kind];
      const way: AlertWay =
        chosen && (ALERT_WAYS as readonly string[]).includes(chosen) ? chosen : defaults[kind];
      return [kind, way];
    }),
  ) as Record<AlertKind, AlertWay>;
  // Urgent safety always rings, whatever was ever kept.
  ways.urgentSafety = 'call';
  return {
    ways,
    quietFrom: kept?.quietFrom ?? ctx.config.ownerDesk.quietFrom,
    quietUntil: kept?.quietUntil ?? ctx.config.ownerDesk.quietUntil,
    updatedAt: kept?.updatedAt ?? null,
    updatedBy: kept?.updatedBy ?? null,
  };
}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "9pm", "21:00", "9", "6.30am" → "21:00", or null. */
export function tidyClock(given: string): string | null {
  const text = given.trim().toLowerCase().replace(/\s+/g, '');
  if (CLOCK.test(text)) return text;
  const match = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/.exec(text);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? '0');
  if (minutes > 59) return null;
  if (match[3]) {
    if (hours < 1 || hours > 12) return null;
    if (match[3] === 'pm' && hours !== 12) hours += 12;
    if (match[3] === 'am' && hours === 12) hours = 0;
  }
  if (hours > 23) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** A clock time as said: "21:00" → "9 pm", "06:30" → "6:30 am". */
export function clockWords(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

/**
 * Checks a change and works out the choices after it, without keeping anything. Refuses urgent
 * safety, an unknown way, a time that is not a time, and a change that changes nothing.
 */
export async function checkAlertChange(
  ctx: PreferenceContext,
  changes: AlertChanges & { urgentSafety?: AlertWay },
): Promise<{ next: AlertPreferences; changed: string[] }> {
  if (changes.urgentSafety !== undefined && changes.urgentSafety !== 'call') {
    throw new BadRequestError('Urgent safety always rings you, even in quiet hours.');
  }
  const now = await alertPreferences(ctx);
  const next: AlertPreferences = { ...now, ways: { ...now.ways } };
  const changed: string[] = [];
  for (const kind of ALERT_KINDS) {
    if (kind === 'urgentSafety') continue;
    const way = changes[kind];
    if (way === undefined) continue;
    if (!(ALERT_WAYS as readonly string[]).includes(way)) {
      throw new BadRequestError(`That is not one of call, text, notification or none.`);
    }
    if (next.ways[kind] !== way) {
      next.ways[kind] = way;
      changed.push(`for ${ALERT_KIND_WORDS[kind]}, ${ALERT_WAY_WORDS[way]}`);
    }
  }
  for (const end of ['quietFrom', 'quietUntil'] as const) {
    const given = changes[end];
    if (given === undefined) continue;
    const tidy = tidyClock(given);
    if (!tidy) throw new BadRequestError('Please give the quiet hours as times, such as 10 pm.');
    if (next[end] !== tidy) {
      next[end] = tidy;
      changed.push(
        `quiet hours ${end === 'quietFrom' ? 'starting' : 'ending'} at ${clockWords(tidy)}`,
      );
    }
  }
  if (changed.length === 0) throw new BadRequestError('That is already how it is set.');
  return { next, changed };
}

/** Keeps a checked change, written in the audit log as the owner's, with how it was done. */
export async function saveAlertPreferences(
  ctx: PreferenceContext,
  changes: AlertChanges,
  who: { actorId: string | null; name: string; via: 'panel' | 'voice'; ip?: string },
): Promise<{ preferences: AlertPreferences; words: string }> {
  const { next, changed } = await checkAlertChange(ctx, changes);
  const at = ctx.now();
  const row: OwnerPreference = {
    ...next.ways,
    quietFrom: next.quietFrom,
    quietUntil: next.quietUntil,
    updatedAt: at,
    updatedBy: who.name,
  };
  await ctx.repository.ownerPreferences.save(row);
  const how = who.via === 'voice' ? 'by voice, talking to Ozi' : 'in the admin panel';
  await ctx.repository.audit.record({
    at,
    actorId: who.actorId,
    actorName: who.name,
    actorRole: 'owner',
    action: 'owner.alerts-changed',
    target: 'owner-alerts',
    detail: `Changed how Ozi reaches the owner ${how}: ${changed.join('; ')}.`.slice(0, 500),
    ip: who.ip ?? '',
  });
  return {
    preferences: { ...next, updatedAt: at, updatedBy: who.name },
    words: `Done. From now on: ${changed.join('; ')}.`,
  };
}

/** The choices in a few spoken sentences. */
export function preferencesWords(preferences: AlertPreferences): string {
  const parts = ALERT_KINDS.map(
    (kind) =>
      `for ${ALERT_KIND_WORDS[kind]}, ${ALERT_WAY_WORDS[preferences.ways[kind]]}${kind === 'urgentSafety' ? ', always' : ''}`,
  );
  return `${parts.join('; ')}. Quiet hours are from ${clockWords(preferences.quietFrom)} to ${clockWords(preferences.quietUntil)}.`;
}

const APPROVALS: ReadonlySet<OwnerMatterKind> = new Set([
  'runner_document',
  'runner_application',
  'partner_product',
  'partner_shop',
  'organisation_enquiry',
  'ambassador_document',
  'ambassador_application',
]);
const MONEY: ReadonlySet<OwnerMatterKind> = new Set([
  'pay_back',
  'till_case',
  'bank_transfer',
  'scheduled_payment',
  'ambassador_share_held',
]);

/**
 * Which of the owner's choices a matter follows: urgent safety for anything urgent (an SOS), the
 * email desk's own word for an email, approvals, money; null for everything else, which is rung
 * about as it always was.
 */
export function alertKindOf(
  matter: Pick<OwnerMatter, 'kind' | 'urgent' | 'alertKind'>,
): AlertKind | null {
  if (matter.urgent || matter.kind === 'sos') return 'urgentSafety';
  if (matter.alertKind) return matter.alertKind;
  if (matter.kind === 'email') return 'importantEmail';
  if (APPROVALS.has(matter.kind)) return 'approvals';
  if (MONEY.has(matter.kind)) return 'money';
  return null;
}

/** How Ozi lets him know about this matter now. Urgent safety is always a call. */
export function wayFor(
  preferences: AlertPreferences,
  matter: Pick<OwnerMatter, 'kind' | 'urgent' | 'alertKind'>,
): AlertWay {
  const kind = alertKindOf(matter);
  if (kind === 'urgentSafety') return 'call';
  return kind ? preferences.ways[kind] : 'call';
}
