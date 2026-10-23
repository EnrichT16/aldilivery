/**
 * The company inbox and staff calls (ruling 77): every account's messages from the company, and
 * the admin panel's side of them. Kept apart from lib/api.ts so it can be read in one go; it uses
 * the same `request`.
 *
 * A Shopper and a Runner are asked with their own sign-in; a Shop Partner and an organisation with
 * their business sign-in. Accounts never message each other: every thread is the company and one
 * account.
 */

import { businessToken, request, staffRequest, type CallJoin } from './api';

/** Which sign-in asks: a Shopper, a Runner, or a Shop Partner or organisation. */
export type InboxAs = 'shopper' | 'runner' | 'business';

function inboxRequest<T>(as: InboxAs, path: string, init?: RequestInit): Promise<T> {
  if (as === 'business') {
    return request<T>(path, { ...init, headers: { 'x-business-token': businessToken() } });
  }
  return request<T>(path, init, as);
}

export interface InboxMessage {
  id: string;
  from: 'company' | 'you';
  fromName: string;
  text: string;
  sentAt: string | null;
  readAt: string | null;
}

export interface CompanyCall {
  id: string;
  status: 'ringing' | 'live' | 'ended';
  from: string;
  words: string;
  notice: string;
}

export function fetchInbox(
  as: InboxAs,
): Promise<{ productName: string; messages: InboxMessage[]; unread: number }> {
  return inboxRequest(as, '/inbox');
}

export function fetchInboxUnread(
  as: InboxAs,
): Promise<{ unread: number; call: CompanyCall | null }> {
  return inboxRequest(as, '/inbox/unread');
}

export function markInboxRead(as: InboxAs): Promise<{ unread: number }> {
  return inboxRequest(as, '/inbox/read', { method: 'POST', body: '{}' });
}

export function replyToInbox(
  as: InboxAs,
  text: string,
): Promise<{ message: InboxMessage; words: string }> {
  return inboxRequest(as, '/inbox/reply', { method: 'POST', body: JSON.stringify({ text }) });
}

export function fetchCompanyCall(as: InboxAs): Promise<{ call: CompanyCall | null }> {
  return inboxRequest(as, '/inbox/call');
}

export function answerCompanyCall(
  as: InboxAs,
  id: string,
): Promise<{ call: CompanyCall; join: CallJoin; notice: string }> {
  return inboxRequest(as, `/inbox/call/${encodeURIComponent(id)}/answer`, {
    method: 'POST',
    body: '{}',
  });
}

export function endCompanyCall(as: InboxAs, id: string): Promise<unknown> {
  return inboxRequest(as, `/inbox/call/${encodeURIComponent(id)}/end`, {
    method: 'POST',
    body: '{}',
  });
}

/* ------------------------------------------------------------------ the admin panel */

export type AccountKind = 'shopper' | 'runner' | 'partner' | 'organisation';

export const ACCOUNT_KIND_WORDS: Record<AccountKind, string> = {
  shopper: 'Shopper',
  runner: 'Runner',
  partner: 'Shop Partner',
  organisation: 'Organisation',
};

export interface ContactMe {
  authoriser: boolean;
  ownAccount: boolean;
  callCodeActive: boolean;
  callCodeUntil: string | null;
  callsOn: boolean;
  phoneOn: boolean;
  recordingOn: boolean;
  recordingNote: string | null;
  messageCodeMinutes: number;
}

export interface ContactAccount {
  id: string;
  name: string;
  kind: AccountKind;
  word: string;
}

export interface StaffThread {
  id: string;
  accountKind: AccountKind;
  accountId: string;
  accountWord: string;
  accountName: string;
  lastMessageAt: string;
  lastFromAccount: boolean;
  unread: number;
  held: number;
}

export interface StaffInboxMessage {
  id: string;
  fromStaff: boolean;
  senderName: string;
  text: string;
  createdAt: string;
  sentAt: string | null;
  readAt: string | null;
  status: 'sent' | 'held' | 'declined';
  authorisedBy: 'self' | 'code' | 'desk' | null;
  authorisedByName: string | null;
}

export interface StaffCallView {
  id: string;
  status: 'ringing' | 'live' | 'ended';
  staffName: string;
  accountKind: AccountKind;
  accountWord: string;
  accountName: string;
  authorisedBy: 'self' | 'code' | 'desk';
  authorisedByName: string | null;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  phoneRung: boolean;
  recording: { status: string; note: string | null; playable: boolean };
}

export type ContactLogEntry =
  | {
      kind: 'message';
      id: string;
      at: string;
      staffName: string;
      recipientWord: string;
      recipientName: string;
      status: 'sent' | 'held' | 'declined';
      sentAt: string | null;
      readAt: string | null;
      authorisedBy: 'self' | 'code' | 'desk' | null;
      authorisedByName: string | null;
    }
  | (StaffCallView & {
      kind: 'call';
      at: string;
      recipientWord: string;
      recipientName: string;
      answered: boolean;
    });

export function fetchContactMe(key: string): Promise<ContactMe> {
  return staffRequest(key, '/staff/contact/me');
}

export function searchContactAccounts(
  key: string,
  kind: AccountKind,
  q: string,
): Promise<{ accounts: ContactAccount[] }> {
  const query = new URLSearchParams({ kind, q }).toString();
  return staffRequest(key, `/staff/contact/accounts?${query}`);
}

export function fetchContactStaff(
  key: string,
): Promise<{ staff: Array<{ id: string; name: string; title: string; authoriser: boolean }> }> {
  return staffRequest(key, '/staff/contact/staff');
}

export function issueContactCode(
  key: string,
  staffId: string,
  kind: 'message' | 'call',
): Promise<{ code: string; expiresAt: string; message: string }> {
  return staffRequest(key, '/staff/contact/codes', {
    method: 'POST',
    body: JSON.stringify({ staffId, kind }),
  });
}

export function enterCallCode(
  key: string,
  code: string,
): Promise<{ callCodeActive: boolean; callCodeUntil: string; message: string }> {
  return staffRequest(key, '/staff/contact/call-code', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export function fetchStaffThreads(
  key: string,
): Promise<{ threads: StaffThread[]; unread: number }> {
  return staffRequest(key, '/staff/messages');
}

export function fetchStaffThread(
  key: string,
  id: string,
): Promise<{
  thread: Pick<StaffThread, 'id' | 'accountKind' | 'accountId' | 'accountWord' | 'accountName'>;
  messages: StaffInboxMessage[];
}> {
  return staffRequest(key, `/staff/messages/${encodeURIComponent(id)}`);
}

export function sendCompanyMessage(
  key: string,
  input: { accountKind: AccountKind; accountId: string; text: string; code?: string },
): Promise<{ message: StaffInboxMessage; notifiedBy: string; words: string }> {
  return staffRequest(key, '/staff/messages/send', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function askForMessageCode(
  key: string,
  input: { accountKind: AccountKind; accountId: string; text: string },
): Promise<{ message: StaffInboxMessage; words: string }> {
  return staffRequest(key, '/staff/messages/ask', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function startCompanyCall(
  key: string,
  input: { accountKind: AccountKind; accountId: string; code?: string; ringPhone?: boolean },
): Promise<{
  call: StaffCallView;
  join: CallJoin;
  notice: string;
  phoneAvailable: boolean;
  words: string;
}> {
  return staffRequest(key, '/staff/calls', { method: 'POST', body: JSON.stringify(input) });
}

export function fetchCompanyCallState(key: string, id: string): Promise<{ call: StaffCallView }> {
  return staffRequest(key, `/staff/calls/${encodeURIComponent(id)}`);
}

export function ringCompanyCallPhone(
  key: string,
  id: string,
): Promise<{ call: StaffCallView; words: string }> {
  return staffRequest(key, `/staff/calls/${encodeURIComponent(id)}/phone`, {
    method: 'POST',
    body: '{}',
  });
}

export function endCompanyCallByStaff(key: string, id: string): Promise<{ call: StaffCallView }> {
  return staffRequest(key, `/staff/calls/${encodeURIComponent(id)}/end`, {
    method: 'POST',
    body: '{}',
  });
}

export function fetchContactLog(
  key: string,
): Promise<{ entries: ContactLogEntry[]; everyone: boolean }> {
  return staffRequest(key, '/staff/contact/log');
}

export function fetchCallRecording(
  key: string,
  id: string,
): Promise<{ url: string; expiresInSeconds: number }> {
  return staffRequest(key, `/staff/calls/${encodeURIComponent(id)}/recording`);
}

export function setTeamAuthoriser(
  key: string,
  id: string,
  canAuthorise: boolean,
): Promise<{ message: string }> {
  return staffRequest(key, `/staff/team/${encodeURIComponent(id)}/authorise`, {
    method: 'POST',
    body: JSON.stringify({ canAuthorise }),
  });
}

/* ------------------------------------------------------------------ in words */

/** "Friday 23 October at 3:05 pm", UK time. */
export function whenWords(iso: string | null): string {
  if (!iso) return '';
  const at = new Date(iso);
  const day = at.toLocaleDateString('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const time = at.toLocaleTimeString('en-GB', {
    timeZone: 'Europe/London',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${day} at ${time}`;
}

/**
 * Ozi reads the messages aloud ("read my messages"), marks them read, and offers a reply by
 * voice: what was heard is read back, and sent only after a yes.
 */
export async function readMessagesAloud(
  as: InboxAs,
  ozi: {
    say: (text: string) => unknown;
    listenFor: (prompt: string, handler: (text: string) => void) => unknown;
  },
  productName: string,
  onChanged?: () => void,
): Promise<void> {
  let messages: InboxMessage[];
  try {
    messages = (await fetchInbox(as)).messages;
  } catch {
    void ozi.say("I couldn't open your messages just now. Please try again in a moment.");
    return;
  }
  const fromCompany = messages.filter((message) => message.from === 'company');
  if (fromCompany.length === 0) {
    void ozi.say(`You have no messages from ${productName}.`);
    return;
  }
  const unread = fromCompany.filter((message) => message.readAt === null);
  const toRead = unread.length > 0 ? unread : fromCompany.slice(-3);
  const intro =
    unread.length > 0
      ? `You have ${unread.length} new ${unread.length === 1 ? 'message' : 'messages'} from ${productName}.`
      : `You have no new messages. Here ${toRead.length === 1 ? 'is the last one' : `are the last ${toRead.length}`}.`;
  const body = toRead
    .map(
      (message, index) =>
        `Message ${index + 1}, from ${message.fromName}, ${whenWords(message.sentAt)}: ${message.text}`,
    )
    .join(' ');
  if (unread.length > 0) {
    await markInboxRead(as).catch(() => undefined);
    onChanged?.();
  }
  ozi.listenFor(`${intro} ${body} To reply, say your reply now. Or say no.`, (answer) => {
    if (/^\s*(no|nope|no thanks|nothing|stop|cancel|not now)\b/i.test(answer)) {
      void ozi.say('All right.');
      return;
    }
    ozi.listenFor(`I heard: ${answer}. Shall I send it? Say yes or no.`, (yes) => {
      if (!/\b(yes|yeah|yep|send it|please)\b/i.test(yes) || /\bno\b/i.test(yes)) {
        void ozi.say('All right, not sent.');
        return;
      }
      void replyToInbox(as, answer)
        .then((result) => {
          void ozi.say(result.words);
          onChanged?.();
        })
        .catch((failure: unknown) =>
          ozi.say(failure instanceof Error ? failure.message : 'That did not send.'),
        );
    });
  });
}

/** "Read my messages", "any messages?", "check my inbox". */
export const READ_MESSAGES =
  /\b(read|check|play|open|hear)\b.{0,15}\b(messages?|inbox)\b|\b(any|my|new)\s+(new\s+)?messages\b|\bmy inbox\b/i;
