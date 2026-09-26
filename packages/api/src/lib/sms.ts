/**
 * Sending a text, through Twilio.
 *
 * Twilio's own library is not used. Sending one message is a single form POST to one address,
 * and a dependency that size, holding the account's credentials, is more to trust than a
 * dozen lines that can be read in full here.
 *
 * Rule Eight: the Twilio account behind these credentials belongs to Aldilivery and nothing
 * else.
 */

export interface TwilioSettings {
  accountSid: string;
  authToken: string;
  /**
   * Who the text comes from. One of: a Twilio phone number in `+44…` form; a Messaging
   * Service identifier, which begins `MG`; or an alphanumeric sender name such as
   * `Aldilivery`, which UK phones show instead of a number.
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
