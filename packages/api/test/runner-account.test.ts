/**
 * A Runner's own account (rulings of 2 October 2026): signing up with every way they might
 * deliver, sending documents from the app, a person deciding them with the photo removed after,
 * switching how they travel, the dashboard, their ID and link, and feedback.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { RUNNER_PAYMENT_PENCE } from '@aldilivery/core';

import { areaOf, orderReference } from '../src/routes/runner-account.js';
import { STAFF, buildTestApp, type TestHarness } from './helpers.js';

let harness: TestHarness;

beforeEach(async () => {
  harness = await buildTestApp(new Date('2026-10-03T10:00:00.000Z'));
});

const PHOTO = Buffer.from('a pretend photo of a document').toString('base64');

async function signUp(travelModes: string[], extra: Record<string, unknown> = {}) {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/runners',
    payload: { name: 'Chidi Okafor', phone: '+447700900301', travelModes, ...extra },
  });
  expect(response.statusCode, response.body).toBe(201);
  const body = response.json() as {
    runner: { id: string; referralCode: string; vehicleType: string };
    token: string;
    nextSteps: string[];
  };
  return { ...body, headers: { authorization: `Bearer ${body.token}` } };
}

function send(headers: Record<string, string>, payload: object) {
  return harness.app.inject({ method: 'POST', url: '/runners/me/documents', headers, payload });
}

describe('signing up', () => {
  it('takes every way they might deliver, starts them walking, and gives them their own ID', async () => {
    const runner = await signUp(['car', 'on_foot', 'bicycle']);
    expect(runner.runner.vehicleType).toBe('on_foot');
    expect(runner.runner.referralCode).toMatch(/^R[A-Z2-9]{7}$/);
    expect(runner.nextSteps).toContain('Your motor insurance certificate, covering delivery work.');
  });

  it('asks only for what walking and cycling need, with no licence or insurance', async () => {
    const runner = await signUp(['on_foot', 'bicycle']);
    const documents = await harness.app.inject({
      method: 'GET',
      url: '/runners/me/documents',
      headers: runner.headers,
    });
    expect(documents.json().stillNeeded.map((d: { kind: string }) => d.kind)).toEqual([
      'face_photo',
      'right_to_work',
      'dbs',
    ]);
  });

  it('records who invited them, from the link they followed', async () => {
    const first = await signUp(['on_foot']);
    const second = await harness.app.inject({
      method: 'POST',
      url: '/runners',
      payload: {
        name: 'Ama',
        phone: '+447700900302',
        travelModes: ['bicycle'],
        referredBy: first.runner.referralCode.toLowerCase(),
      },
    });
    const stored = await harness.repository.runners.findById(second.json().runner.id);
    expect(stored?.referredBy).toBe(first.runner.referralCode);
  });
});

describe('documents', () => {
  it('takes a photo, or a share code where one will do, and says what is still needed', async () => {
    const runner = await signUp(['on_foot']);
    const photo = await send(runner.headers, {
      kind: 'face_photo',
      image: PHOTO,
      contentType: 'image/jpeg',
    });
    expect(photo.statusCode, photo.body).toBe(201);
    const code = await send(runner.headers, { kind: 'right_to_work', shareCode: 'w4x 7yz 9ab' });
    expect(code.statusCode).toBe(201);
    expect(code.json().stillNeeded.map((d: { kind: string }) => d.kind)).toEqual(['dbs']);

    expect(
      (await send(runner.headers, { kind: 'face_photo', shareCode: 'ABC123456' })).statusCode,
    ).toBe(400);
    expect((await send(runner.headers, { kind: 'dbs' })).json().error.message).toBe(
      'Please send a photo, or type the share code.',
    );
  });

  it('needs the date motor insurance runs out', async () => {
    const runner = await signUp(['car']);
    const refused = await send(runner.headers, {
      kind: 'insurance',
      image: PHOTO,
      contentType: 'image/jpeg',
    });
    expect(refused.json().error.message).toBe('Please give the date your insurance runs out.');
  });

  it('lets staff see and decide them; the photo is removed, the decision kept, the check recorded', async () => {
    const runner = await signUp(['on_foot']);
    await send(runner.headers, { kind: 'dbs', image: PHOTO, contentType: 'image/png' });
    const waiting = await harness.app.inject({
      method: 'GET',
      url: '/staff/documents',
      headers: STAFF,
    });
    const [document] = waiting.json().documents as Array<{ id: string; runner: { name: string } }>;
    expect(document?.runner.name).toBe('Chidi Okafor');

    const image = await harness.app.inject({
      method: 'GET',
      url: `/staff/documents/${document!.id}/image`,
      headers: STAFF,
    });
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.rawPayload.toString()).toBe('a pretend photo of a document');

    const noKey = await harness.app.inject({
      method: 'GET',
      url: `/staff/documents/${document!.id}/image`,
    });
    expect(noKey.statusCode).toBe(403);

    const decided = await harness.app.inject({
      method: 'POST',
      url: `/staff/documents/${document!.id}/review`,
      headers: STAFF,
      payload: { decision: 'accept', by: 'Anthony' },
    });
    expect(decided.statusCode, decided.body).toBe(200);
    const stored = await harness.repository.runnerDocuments.findById(document!.id);
    expect(stored).toMatchObject({ status: 'accepted', reviewedBy: 'Anthony', image: null });
    expect(
      (await harness.repository.runners.findById(runner.runner.id))?.criminalRecordCheckVerified,
    ).toBe(true);
    expect(
      (await harness.repository.runnerChecks.listForRunner(runner.runner.id))[0],
    ).toMatchObject({
      kind: 'criminal_record',
      checkedBy: 'Anthony',
    });
  });

  it('keeps the face photo once accepted, for the Shopper at the door', async () => {
    const runner = await signUp(['on_foot']);
    const sent = await send(runner.headers, {
      kind: 'face_photo',
      image: PHOTO,
      contentType: 'image/jpeg',
    });
    const id = sent.json().document.id as string;
    await harness.app.inject({
      method: 'POST',
      url: `/staff/documents/${id}/review`,
      headers: STAFF,
      payload: { decision: 'accept', by: 'Anthony' },
    });
    expect((await harness.repository.runnerDocuments.findById(id))?.image).not.toBeNull();
  });

  it('says why when one is turned down, and asks for it again', async () => {
    const runner = await signUp(['on_foot']);
    const sent = await send(runner.headers, {
      kind: 'dbs',
      image: PHOTO,
      contentType: 'image/jpeg',
    });
    const id = sent.json().document.id as string;
    const noReason = await harness.app.inject({
      method: 'POST',
      url: `/staff/documents/${id}/review`,
      headers: STAFF,
      payload: { decision: 'reject', by: 'Anthony' },
    });
    expect(noReason.statusCode).toBe(400);
    await harness.app.inject({
      method: 'POST',
      url: `/staff/documents/${id}/review`,
      headers: STAFF,
      payload: {
        decision: 'reject',
        by: 'Anthony',
        note: 'The photo was blurred. Please take it again in good light.',
      },
    });
    const mine = await harness.app.inject({
      method: 'GET',
      url: '/runners/me/documents',
      headers: runner.headers,
    });
    expect(mine.json().documents[0]).toMatchObject({
      status: 'rejected',
      reviewNote: 'The photo was blurred. Please take it again in good light.',
    });
    expect(mine.json().stillNeeded.map((d: { kind: string }) => d.kind)).toContain('dbs');
  });
});

describe('how they travel today', () => {
  it('switches to walking or cycling at once, with nothing needed', async () => {
    const runner = await signUp(['car']);
    const walking = await harness.app.inject({
      method: 'POST',
      url: '/runners/me/travel-mode',
      headers: runner.headers,
      payload: { mode: 'bicycle' },
    });
    expect(walking.statusCode).toBe(200);
    expect(walking.json().message).toBe('Done. You are delivering by bicycle.');
  });

  it('allows a car only with a licence and in-date insurance, both accepted', async () => {
    const runner = await signUp(['car', 'on_foot']);
    const refused = await harness.app.inject({
      method: 'POST',
      url: '/runners/me/travel-mode',
      headers: runner.headers,
      payload: { mode: 'car' },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toMatch(/check your driving licence and insurance/);

    for (const kind of ['driving_licence_front', 'driving_licence_back']) {
      const sent = await send(runner.headers, { kind, image: PHOTO, contentType: 'image/jpeg' });
      await harness.app.inject({
        method: 'POST',
        url: `/staff/documents/${sent.json().document.id}/review`,
        headers: STAFF,
        payload: { decision: 'accept', by: 'Anthony' },
      });
    }
    const insurance = await send(runner.headers, {
      kind: 'insurance',
      image: PHOTO,
      contentType: 'image/jpeg',
      expiresOn: '2027-03-31',
    });
    await harness.app.inject({
      method: 'POST',
      url: `/staff/documents/${insurance.json().document.id}/review`,
      headers: STAFF,
      payload: { decision: 'accept', by: 'Anthony' },
    });
    const allowed = await harness.app.inject({
      method: 'POST',
      url: '/runners/me/travel-mode',
      headers: runner.headers,
      payload: { mode: 'car' },
    });
    expect(allowed.statusCode, allowed.body).toBe(200);

    harness.setNow(new Date('2027-04-01T09:00:00.000Z'));
    const lapsed = await harness.app.inject({
      method: 'POST',
      url: '/runners/me/travel-mode',
      headers: runner.headers,
      payload: { mode: 'car' },
    });
    expect(lapsed.json().error.message).toMatch(/insurance has run out/);
  });

  it('will not put a driver on shift without the checks, but will once they walk', async () => {
    const runner = await signUp(['car', 'on_foot'], { vehicleType: 'car' });
    const onShift = (available: boolean) =>
      harness.app.inject({
        method: 'POST',
        url: '/runners/me/availability',
        headers: runner.headers,
        payload: { available },
      });
    expect((await onShift(true)).statusCode).toBe(409);
    await harness.app.inject({
      method: 'POST',
      url: '/runners/me/travel-mode',
      headers: runner.headers,
      payload: { mode: 'on_foot' },
    });
    expect((await onShift(true)).statusCode).toBe(200);
  });
});

describe('the dashboard', () => {
  it('shows today, this week and all time, each job by reference and area, and the link to share', async () => {
    const runner = await signUp(['on_foot']);
    const shopper = await harness.repository.shoppers.create({
      displayName: 'Margaret',
      handle: 'margaret',
      phone: '+447700900001',
    });
    const deliveredOn = async (at: string, address: string) => {
      const order = await harness.repository.orders.create({
        shopperId: shopper.id,
        goodsEstimatePence: 500,
        feePence: 1350,
        totalEstimatePence: 1850,
        deliveryAddress: address,
        doorstepProtocolSnapshot: '',
        items: [],
      } as never);
      await harness.repository.orders.update(order.id, {
        runnerId: runner.runner.id,
        status: 'delivered',
        deliveredAt: new Date(at),
      });
      return order.id;
    };
    const todayId = await deliveredOn(
      '2026-10-03T09:00:00Z',
      '12 Example Street, Gillingham, ME7 1AA',
    );
    await deliveredOn('2026-09-29T09:00:00Z', '3 High Street, Chatham ME4 4AB'); // Monday this week
    await deliveredOn('2026-09-20T09:00:00Z', '1 Somewhere'); // weeks ago

    const response = await harness.app.inject({
      method: 'GET',
      url: '/runners/me/dashboard',
      headers: runner.headers,
    });
    const body = response.json();
    expect(body.earnings).toMatchObject({
      todayPence: RUNNER_PAYMENT_PENCE,
      weekPence: 2 * RUNNER_PAYMENT_PENCE,
      allTimePence: 3 * RUNNER_PAYMENT_PENCE,
      todayWords: '£5.00 today',
      jobsToday: 1,
    });
    expect(body.jobs[0]).toMatchObject({
      reference: orderReference(todayId),
      area: 'ME7',
      paid: false,
    });
    expect(body.runnerId).toBe(runner.runner.referralCode);
    expect(body.shareLink).toMatch(new RegExp(`/join\\?ref=${runner.runner.referralCode}$`));
    // No Shopper's name, address or number reaches the Runner's dashboard.
    expect(response.body).not.toMatch(/Margaret|Example Street|\+44/);
  });

  it('reads the area from a UK postcode, and never shows the street', () => {
    expect(areaOf('Flat 2, 10 Canterbury Street, Gillingham ME7 5TU')).toBe('ME7');
    expect(areaOf('1 Somewhere')).toBe('Area not recorded');
  });
});

describe('feedback', () => {
  it('is kept with their name, or without it if they ask', async () => {
    const runner = await signUp(['on_foot']);
    const named = await harness.app.inject({
      method: 'POST',
      url: '/runners/me/feedback',
      headers: runner.headers,
      payload: { message: 'The app could read the shopping list aloud.' },
    });
    expect(named.statusCode).toBe(201);
    await harness.app.inject({
      method: 'POST',
      url: '/runners/me/feedback',
      headers: runner.headers,
      payload: { message: 'Something private.', anonymous: true },
    });
    const kept = await harness.repository.runnerFeedback.list();
    expect(kept.map((f) => f.runnerId)).toEqual([null, runner.runner.id]);
  });
});
