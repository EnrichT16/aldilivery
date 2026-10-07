/**
 * Share links for everybody (ruling 44): staff, the owner, family, investors and Shoppers each
 * have one, with a count of the accounts opened through it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, signUpRunner, signUpShopper, STAFF, type TestHarness } from './helpers.js';

let harness: TestHarness;

beforeEach(async () => {
  harness = await buildTestApp(new Date('2026-10-07T10:00:00.000Z'));
});

afterEach(async () => {
  await harness.close();
});

function share(headers: Record<string, string>) {
  return harness.app.inject({ method: 'GET', url: '/share', headers });
}

describe('share links for everybody', () => {
  it('counts the Shoppers who joined through a staff member’s link', async () => {
    const made = (
      await harness.app.inject({
        method: 'POST',
        url: '/staff/team',
        payload: { name: 'Kemi', username: 'kemi', role: 'onboarding' },
        headers: STAFF,
      })
    ).json();
    const token = (
      await harness.app.inject({
        method: 'POST',
        url: '/staff/sign-in',
        payload: { username: 'kemi', password: made.password },
      })
    ).json().token as string;
    const before = (await share({ 'x-staff-token': token })).json();
    expect(before.link).toMatch(/\/join\?via=staff-[A-Za-z0-9_-]+$/);
    expect(before.joined).toBe(0);

    const via = `staff:${before.link.split('via=staff-')[1]}`;
    const joined = await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: { displayName: 'Ada', phone: '+447700900222', joinedVia: via },
    });
    expect(joined.statusCode, joined.body).toBe(201);
    expect((await share({ 'x-staff-token': token })).json().joined).toBe(1);
  });

  it('gives a Shopper a link by their handle, and the staff key the founder’s', async () => {
    const shopper = await signUpShopper(harness);
    expect((await share(shopper.authHeader)).json().link).toMatch(/via=shopper-margaret/);
    expect((await share(STAFF)).json().link).toMatch(/via=staff-founder$/);
  });

  it('asks a Runner or a stranger to sign in, and refuses a made-up source', async () => {
    const runner = await signUpRunner(harness);
    expect((await share(runner.authHeader)).statusCode).toBe(401);
    expect((await share({})).statusCode).toBe(401);
    const bad = await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: { displayName: 'Ada', phone: '+447700900223', joinedVia: 'owner:everything' },
    });
    expect(bad.statusCode).toBe(400);
  });
});
