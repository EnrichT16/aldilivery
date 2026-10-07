/**
 * Ordering by telephone, answered by Ozi (rulings 28, 29 and 45), acted out call by call with
 * requests signed the way Twilio signs them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { twilioSignature } from '../src/lib/twilio-voice.js';
import { buildTestApp, seedCatalogue, signUpShopper, type TestHarness } from './helpers.js';

const ORIGIN = 'https://shop.example.test';
const TOKEN = 'twilio-auth-token-for-tests';

let harness: TestHarness;
let texts: Array<{ to: string; body: string }>;
let rang: Array<{ to: string; url: string }>;

beforeEach(async () => {
  texts = [];
  rang = [];
  harness = await buildTestApp(new Date('2026-10-07T10:00:00.000Z'), {
    env: { primaryOrigin: ORIGIN, twilioAuthToken: TOKEN },
    sendText: async (to, body) => {
      texts.push({ to, body });
    },
    placeCall: async (to, url) => {
      rang.push({ to, url });
    },
  });
  await seedCatalogue(harness.repository);
});

afterEach(async () => {
  await harness.close();
});

/** A request as Twilio sends it: a form, signed with the Auth Token over the full address. */
function twilio(path: string, params: Record<string, string>, sign = true) {
  const signature = twilioSignature(TOKEN, `${ORIGIN}${path}`, params);
  return harness.app.inject({
    method: 'POST',
    url: path,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(sign ? { 'x-twilio-signature': signature } : {}),
    },
    payload: new URLSearchParams(params).toString(),
  });
}

/** Where Ozi sends the next answer, from the TwiML. */
function nextStep(twiml: string): string {
  const action = /action="([^"]+)"/.exec(twiml)?.[1] ?? '';
  return action.replace(/&amp;/g, '&').replace(ORIGIN, '');
}

function spoken(twiml: string): string {
  return [...twiml.matchAll(/<Say[^>]*>([^<]*)<\/Say>/g)].map((m) => m[1]).join(' ');
}

async function readyShopper() {
  const shopper = await signUpShopper(harness, { displayName: 'Margaret Ade' });
  await harness.repository.shoppers.update(shopper.shopperId, {
    deliveryAddress: '1 High Street, London',
  });
  return shopper;
}

describe('the telephone line', () => {
  it('refuses anything Twilio did not sign', async () => {
    const response = await twilio(
      '/api/webhooks/twilio/voice',
      { CallSid: 'CA1', From: '+447700900001' },
      false,
    );
    expect(response.statusCode).toBe(403);
  });

  it('takes an order from a known caller, reads it back, and sends it after a yes', async () => {
    const shopper = await readyShopper();
    const call = { CallSid: 'CA2', From: '+447700900001', Direction: 'inbound' };

    const hello = await twilio('/api/webhooks/twilio/voice', call);
    expect(hello.statusCode).toBe(200);
    expect(hello.headers['content-type']).toMatch(/text\/xml/);
    expect(spoken(hello.body)).toMatch(/^Hello Margaret, it's Ozi\. What would you like/);

    const added = await twilio(nextStep(hello.body), {
      ...call,
      SpeechResult: 'Two milk and a loaf of bread please',
    });
    expect(spoken(added.body)).toMatch(
      /I've added 2 Semi skimmed milk, 2 pints, about £2\.50 and 1 White sliced bread, 800g, about £0\.89\. Anything else\?/,
    );

    const readBack = await twilio(nextStep(added.body), {
      ...call,
      SpeechResult: "That's everything.",
    });
    expect(spoken(readBack.body)).toMatch(/Here is your order\. 2 Semi skimmed milk/);
    expect(spoken(readBack.body)).toMatch(/Delivery is £13\.50/);
    expect(spoken(readBack.body)).toMatch(/card ending 4 2 4 2/);
    expect(spoken(readBack.body)).toMatch(
      /home address: 1 High Street, London\. Shall I send it\?/,
    );

    const sent = await twilio(nextStep(readBack.body), { ...call, SpeechResult: 'Yes please' });
    expect(spoken(sent.body)).toMatch(/Thank you\. Your order is on its way to a Runner/);
    expect(sent.body).toContain('<Hangup/>');

    const orders = await harness.repository.orders.listForShopper(shopper.shopperId);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      status: 'paid',
      confirmationChannel: 'voice',
      deliveryAddress: '1 High Street, London',
    });
    expect(orders[0]!.confirmationStatement).toMatch(/^By telephone: yes to 2 Semi skimmed milk/);
    // No app, so no notification: a text instead, as the order goes along.
    await vi.waitFor(() => {
      expect(texts).toContainEqual({
        to: '+447700900001',
        body: `${harness.config.productName}: We have your order and are finding a Runner now.`,
      });
    });
  });

  it('takes something off, and sends nothing after a no', async () => {
    const shopper = await readyShopper();
    const call = { CallSid: 'CA3', From: '+447700900001' };
    const hello = await twilio('/api/webhooks/twilio/voice', call);
    const added = await twilio(nextStep(hello.body), { ...call, SpeechResult: 'milk and beans' });
    const removed = await twilio(nextStep(added.body), {
      ...call,
      SpeechResult: 'take off the beans',
    });
    expect(spoken(removed.body)).toMatch(/I've taken off the Baked beans, 415g\./);
    const readBack = await twilio(nextStep(removed.body), { ...call, SpeechResult: 'that is all' });
    expect(spoken(readBack.body)).not.toMatch(/beans/);
    const no = await twilio(nextStep(readBack.body), { ...call, SpeechResult: 'no' });
    expect(spoken(no.body)).toMatch(/nothing has been sent/);
    expect(await harness.repository.orders.listForShopper(shopper.shopperId)).toHaveLength(0);
  });

  it('never adds something age restricted', async () => {
    await readyShopper();
    const call = { CallSid: 'CA4', From: '+447700900001' };
    const hello = await twilio('/api/webhooks/twilio/voice', call);
    const asked = await twilio(nextStep(hello.body), { ...call, SpeechResult: 'red wine' });
    expect(spoken(asked.body)).toMatch(/I couldn't find red wine/);
  });

  it('asks a stranger to keep their number, then their name, and texts the sign-up link', async () => {
    const call = { CallSid: 'CA5', From: '07700 900999' };
    const hello = await twilio('/api/webhooks/twilio/voice', call);
    expect(spoken(hello.body)).toMatch(
      /Just in case this call gets cut off, I'd like to keep your number so I can call you back/,
    );
    const yes = await twilio(nextStep(hello.body), { ...call, SpeechResult: 'yes' });
    expect(spoken(yes.body)).toMatch(/What is your first name and your surname/);
    const named = await twilio(nextStep(yes.body), { ...call, SpeechResult: 'My name is Ada Obi' });
    expect(spoken(named.body)).toMatch(/^Thank you, Ada\./);
    expect(spoken(named.body)).toMatch(/A card is never given to me on a call/);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ to: '+447700900999' });
    expect(texts[0]!.body).toContain(`${ORIGIN}/sign-up`);
    // No account is made from a phone call alone.
    expect(await harness.repository.shoppers.findByPhone('+447700900999')).toBeNull();
  });

  it('texts a known caller with no card the link, and never asks for the card', async () => {
    await signUpShopper(harness, { phone: '+447700900002' });
    const noCard = await harness.repository.shoppers.findByPhone('+447700900002');
    // A Shopper with no address yet.
    expect(noCard?.deliveryAddress).toBe('');
    const hello = await twilio('/api/webhooks/twilio/voice', {
      CallSid: 'CA6',
      From: '+447700900002',
    });
    expect(spoken(hello.body)).toMatch(
      /your card and home address need adding once, on the website/,
    );
    expect(hello.body).toContain('<Hangup/>');
    expect(texts).toHaveLength(1);
  });

  it('rings back once when cut off mid-order, and carries on where they were', async () => {
    await readyShopper();
    const call = { CallSid: 'CA7', From: '+447700900001' };
    const hello = await twilio('/api/webhooks/twilio/voice', call);
    await twilio(nextStep(hello.body), { ...call, SpeechResult: 'milk' });

    await twilio('/api/webhooks/twilio/status', { ...call, CallStatus: 'completed' });
    expect(rang).toHaveLength(1);
    expect(rang[0]!.to).toBe('+447700900001');

    const back = await twilio(rang[0]!.url.replace(ORIGIN, ''), {
      CallSid: 'CA8',
      To: '+447700900001',
      From: '+447700900000',
      Direction: 'outbound-api',
    });
    expect(spoken(back.body)).toMatch(
      /ringing you back because we were cut off\. So far you have 1 Semi skimmed milk/,
    );

    // Only once.
    await twilio('/api/webhooks/twilio/status', { ...call, CallStatus: 'completed' });
    expect(rang).toHaveLength(1);
  });

  it('does not ring back after a finished call', async () => {
    await readyShopper();
    const call = { CallSid: 'CA9', From: '+447700900001' };
    const hello = await twilio('/api/webhooks/twilio/voice', call);
    await twilio(nextStep(hello.body), { ...call, SpeechResult: 'cancel' });
    await twilio('/api/webhooks/twilio/status', { ...call, CallStatus: 'completed' });
    expect(rang).toHaveLength(0);
  });

  it('refuses a step whose saved place was tampered with', async () => {
    await readyShopper();
    const call = { CallSid: 'CA10', From: '+447700900001' };
    const hello = await twilio('/api/webhooks/twilio/voice', call);
    const tampered = nextStep(hello.body).replace(/s=([^.]+)/, 's=eyJzdGVwIjoiY29uZmlybSJ9');
    const response = await twilio(tampered, { ...call, SpeechResult: 'yes' });
    expect(spoken(response.body)).toMatch(/lost my place/);
  });

  it('answers a text with how to order, never asking for a card', async () => {
    const response = await twilio('/api/webhooks/twilio/sms', {
      From: '+447700900001',
      Body: 'hi',
    });
    expect(response.body).toMatch(/<Message>.*texts to this number are not read.*<\/Message>/);
  });
});
