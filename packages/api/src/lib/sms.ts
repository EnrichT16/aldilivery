/**
 * Sending a text, through Twilio.
 *
 * Twilio's own library is not used. Sending one message is a single form POST to one address,
 * and a dependency that size, holding the account's credentials, is more to trust than a
 * dozen lines that can be read in full here.
 *
 * Rule Eight: the Twilio account behind these credentials belongs to the service and nothing
 * else.
 */

export interface TwilioSettings {
  accountSid: string;
  authToken: string;
  /**
   * Who the text comes from. One of: a Twilio phone number in `+44…` form; a Messaging
   * Service identifier, which begins `MG`; or an alphanumeric sender name such as
   * `OziDelivery`, which UK phones show instead of a number.
   */
  from: string;
}

export type SendText = (to: string, body: string) => Promise<void>;

export function twilioSender(settings: TwilioSettings, fetchImpl: typeof fetch = fetch): SendText {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(settings.accountSid)}/Messages.json`;
  const authorisation = `Basic ${Buffer.from(`${settings.accountSid}:${settings.authToken}`).toString('base64')}`;

  return async (to, body) => {
    const form = new URLSearchParams({ To: to, Body: body });
    if (settings.from.startsWith('MG')) form.set('MessagingServiceSid', settings.from);
    else form.set('From', settings.from);

    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: authorisation,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });

    if (!response.ok) {
      // Twilio says what went wrong in `message`, with a numbered `code`. Both go to the
      // log, never to the person asking: they are about our account, not their phone.
      let detail = `HTTP ${response.status}`;
      try {
        const failure = (await response.json()) as { code?: number; message?: string };
        detail = `Twilio ${failure.code ?? response.status}: ${failure.message ?? 'no message'}`;
      } catch {
        // Not JSON. The status is all there is.
      }
      throw new Error(detail);
    }
  };
}

/**
 * The text itself. Short, because it is read on a phone and perhaps read aloud by one.
 *
 * The last line is the format browsers look for to offer the code automatically — Chrome on
 * Android fills it in without the person having to switch apps and remember six digits. It
 * only works when the text names the site's own address, so it is left off if there is not
 * exactly one.
 */
export function codeMessage(input: {
  productName: string;
  code: string;
  minutes: number;
  origin?: string | undefined;
}): string {
  const lines = [
    `${input.productName}: your code is ${input.code}. It lasts ${input.minutes} minutes.`,
    'We will never phone you to ask for it.',
  ];
  const host = input.origin ? safeHost(input.origin) : undefined;
  if (host) lines.push('', `@${host} #${input.code}`);
  return lines.join('\n');
}

function safeHost(origin: string): string | undefined {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' ? url.host : undefined;
  } catch {
    return undefined;
  }
}

export type CallWithCode = (to: string, code: string) => Promise<void>;

/**
 * A code spoken by an automatic phone call, for a landline, which cannot receive a text
 * (Anthony, 4 October 2026). The words are given to Twilio inline, so nothing is fetched from
 * our server during the call and the code is never in a web address.
 */
export function twilioCaller(
  settings: { accountSid: string; authToken: string; from: string },
  script: (code: string) => string,
  fetchImpl: typeof fetch = fetch,
): CallWithCode {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(settings.accountSid)}/Calls.json`;
  const authorisation = `Basic ${Buffer.from(`${settings.accountSid}:${settings.authToken}`).toString('base64')}`;
  return async (to, code) => {
    const form = new URLSearchParams({ To: to, From: settings.from, Twiml: script(code) });
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: authorisation,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const failure = (await response.json()) as { code?: number; message?: string };
        detail = `Twilio ${failure.code ?? response.status}: ${failure.message ?? 'no message'}`;
      } catch {
        // Not JSON. The status is all there is.
      }
      throw new Error(detail);
    }
  };
}

const DIGIT_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
];

/** "472913" → "four seven, two nine, one three": in twos, like every number Ozi reads out. */
export function codeInTwos(code: string): string {
  return (code.match(/\d{1,2}/g) ?? [])
    .map((pair) =>
      pair
        .split('')
        .map((d) => DIGIT_WORDS[Number(d)])
        .join(' '),
    )
    .join(', ');
}

/**
 * What the call says: who is calling, the code in twos, slowly, three times, and the warning.
 * British English, at a pace an older person can write down.
 */
export function callScript(input: { productName: string; code: string; minutes: number }): string {
  const spoken = codeInTwos(input.code);
  const say = (text: string): string =>
    `<Say voice="Polly.Amy" language="en-GB">${escapeXml(text)}</Say><Pause length="1"/>`;
  return [
    '<Response>',
    '<Pause length="1"/>',
    say(`Hello. This is ${input.productName}, with the code you asked for.`),
    say(`Your code is: ${spoken}.`),
    say(`Again: ${spoken}.`),
    say(`One more time: ${spoken}.`),
    say(`It lasts ${input.minutes} minutes. We will never phone you to ask for it. Goodbye.`),
    '</Response>',
  ].join('');
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
