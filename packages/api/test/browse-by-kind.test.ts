/**
 * Browsing places by kind (ruling 82, 25 October 2026): GET /shops narrowed to a section
 * (restaurants, shops, convenience, services), a cuisine, a speciality or a category, searched,
 * and ordered near first by postcode district; the fields set on joining, by the partner on the
 * dashboard and by staff, checked against the lists in config; a childminder's Ofsted number.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadShopsSeed, seedShops } from '../src/lib/shops-seed.js';
import { buildTestApp, STAFF, type TestHarness } from './helpers.js';

let harness: TestHarness;

beforeEach(async () => {
  harness = await buildTestApp(new Date('2026-10-25T10:00:00.000Z'));
});

afterEach(async () => {
  await harness.close();
});

async function addPlace(payload: Record<string, unknown>) {
  return harness.app.inject({
    method: 'POST',
    url: '/staff/partners',
    headers: STAFF,
    payload: { address: '1 High Street', hours: 'Every day', telephone: '', ...payload },
  });
}

async function shops(query = '') {
  const response = await harness.app.inject({ method: 'GET', url: `/shops${query}` });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as {
    shops: Array<{
      id: string;
      name: string;
      section: string;
      cuisines: string[];
      specialities: string[];
      categories: string[];
      convenience: boolean;
      ofstedNumber: string;
      nearYou: boolean | null;
    }>;
    near: string | null;
  };
}

const names = (body: Awaited<ReturnType<typeof shops>>): string[] =>
  body.shops.map((shop) => shop.name);

async function addTheHighStreet(): Promise<void> {
  const places = [
    {
      name: 'Mama Joy Kitchen',
      kind: 'food',
      postcode: 'ME7 1AA',
      about: 'Jollof rice and suya.',
      cuisines: ['african'],
    },
    { name: 'Bangkok House', kind: 'food', postcode: 'ME8 0AA', about: '', cuisines: ['Thai'] },
    {
      name: 'Anatolia Market',
      kind: 'shop',
      postcode: 'DA1 1AA',
      about: 'Fresh bread and olives.',
      specialities: ['Turkish', 'Halal'],
    },
    {
      name: 'Istanbul Grocers',
      kind: 'shop',
      postcode: 'ME7 2BB',
      about: '',
      specialities: ['Turkish'],
    },
    { name: 'Corner Stop', kind: 'shop', postcode: 'ME7 3CC', about: '', convenience: true },
    {
      name: 'Drip Fixers',
      kind: 'service',
      postcode: 'ME4 4DD',
      about: 'Leaks and boilers.',
      categories: ['Plumber'],
    },
    {
      name: 'Little Acorns',
      kind: 'service',
      postcode: 'ME7 5EE',
      about: '',
      categories: ['Nanny and childminder'],
      ofstedNumber: 'ey 123456',
    },
  ];
  for (const place of places) {
    const added = await addPlace(place);
    expect(added.statusCode, added.body).toBe(201);
  }
}

describe('GET /shops by kind', () => {
  it('lists each section on its own, convenience stores apart from shops', async () => {
    await addTheHighStreet();
    expect(names(await shops('?section=restaurants')).sort()).toEqual([
      'Bangkok House',
      'Mama Joy Kitchen',
    ]);
    expect(names(await shops('?section=shops')).sort()).toEqual([
      'Anatolia Market',
      'Istanbul Grocers',
    ]);
    const convenience = await shops('?section=convenience');
    expect(names(convenience)).toEqual(['Corner Stop']);
    expect(convenience.shops[0]).toEqual(
      expect.objectContaining({ section: 'convenience', convenience: true }),
    );
    expect(names(await shops('?section=services')).sort()).toEqual([
      'Drip Fixers',
      'Little Acorns',
    ]);
    // With no section, everything, as before.
    expect((await shops()).shops).toHaveLength(7);
  });

  it('filters by cuisine, speciality and category, spelt as the list spells them', async () => {
    await addTheHighStreet();
    const african = await shops('?section=restaurants&cuisine=African');
    expect(names(african)).toEqual(['Mama Joy Kitchen']);
    expect(african.shops[0]!.cuisines).toEqual(['African']);
    expect(names(await shops('?section=restaurants&cuisine=Japanese'))).toEqual([]);
    expect(names(await shops('?section=shops&speciality=turkish')).sort()).toEqual([
      'Anatolia Market',
      'Istanbul Grocers',
    ]);
    expect(names(await shops('?section=shops&speciality=Halal'))).toEqual(['Anatolia Market']);
    const plumbers = await shops('?section=services&category=Plumber');
    expect(names(plumbers)).toEqual(['Drip Fixers']);
    const childminders = await shops('?section=services&category=Nanny%20and%20childminder');
    expect(childminders.shops[0]!.ofstedNumber).toBe('EY123456');
  });

  it('searches names, descriptions and cuisines, specialities and categories', async () => {
    await addTheHighStreet();
    expect(names(await shops('?q=jollof'))).toEqual(['Mama Joy Kitchen']);
    expect(names(await shops('?section=restaurants&q=an%20african%20restaurant'))).toEqual([
      'Mama Joy Kitchen',
    ]);
    expect(names(await shops('?q=find%20a%20plumber'))).toEqual(['Drip Fixers']);
    expect(names(await shops('?q=olives'))).toEqual(['Anatolia Market']);
    expect(names(await shops('?q=istanbul'))).toEqual(['Istanbul Grocers']);
  });

  it('puts the same postcode district first, then the same area letters, then the rest', async () => {
    await addTheHighStreet();
    const turkish = await shops('?section=shops&near=ME7%201ER');
    expect(turkish.near).toBe('ME7');
    // Anatolia Market joined first, but it is in DA1; Istanbul Grocers is in ME7.
    expect(names(turkish)).toEqual(['Istanbul Grocers', 'Anatolia Market']);
    expect(turkish.shops.map((shop) => shop.nearYou)).toEqual([true, false]);
    const restaurants = await shops('?section=restaurants&near=ME8%209ZZ');
    expect(names(restaurants)).toEqual(['Bangkok House', 'Mama Joy Kitchen']);
    expect(restaurants.shops.map((shop) => shop.nearYou)).toEqual([true, false]);
    const everything = await shops('?near=DA1%202BB');
    expect(everything.shops[0]!.name).toBe('Anatolia Market');
    // With no postcode, nobody is marked near or far.
    expect((await shops('?section=shops')).shops.map((shop) => shop.nearYou)).toEqual([null, null]);
  });
});

describe('setting what a place is browsed under', () => {
  it('refuses anything off the lists, and a childminder without an Ofsted number', async () => {
    const odd = await addPlace({
      name: 'Moon Diner',
      kind: 'food',
      postcode: 'ME7 1AA',
      cuisines: ['Martian'],
    });
    expect(odd.statusCode).toBe(400);
    expect(odd.json().error.message).toMatch(/Martian is not on our list of cuisines/);
    const loans = await addPlace({
      name: 'Quick Cash',
      kind: 'service',
      postcode: 'ME7 1AA',
      categories: ['Payday loans'],
    });
    expect(loans.statusCode).toBe(400);
    const childminder = await addPlace({
      name: 'Tiny Steps',
      kind: 'service',
      postcode: 'ME7 1AA',
      categories: ['Nanny and childminder'],
    });
    expect(childminder.statusCode).toBe(400);
    expect(childminder.json().error.message).toMatch(/registered with Ofsted/);
    const wrongNumber = await addPlace({
      name: 'Tiny Steps',
      kind: 'service',
      postcode: 'ME7 1AA',
      categories: ['Nanny and childminder'],
      ofstedNumber: 'not a number',
    });
    expect(wrongNumber.statusCode).toBe(400);
  });

  it('keeps only the fields a kind has: no cuisines on a shop, no convenience on a café', async () => {
    const added = await addPlace({
      name: 'Hybrid',
      kind: 'food',
      postcode: 'ME7 1AA',
      cuisines: ['Greek'],
      specialities: ['Turkish'],
      convenience: true,
    });
    expect(added.statusCode, added.body).toBe(201);
    expect(added.json().shop).toEqual(
      expect.objectContaining({ cuisines: ['Greek'], specialities: [], convenience: false }),
    );
  });

  it('is set by staff on approving, and by the partner on the dashboard', async () => {
    const added = await addPlace({ name: 'Village Stores', kind: 'shop', postcode: 'ME3 1AA' });
    const id = added.json().shop.id as string;
    expect(names(await shops('?section=convenience'))).toEqual([]);
    const marked = await harness.app.inject({
      method: 'POST',
      url: `/staff/partners/${id}`,
      headers: STAFF,
      payload: { convenience: true, specialities: ['Polish'] },
    });
    expect(marked.statusCode, marked.body).toBe(200);
    expect(names(await shops('?section=convenience'))).toEqual(['Village Stores']);

    const user = await harness.app.inject({
      method: 'POST',
      url: `/staff/partners/${id}/users`,
      headers: STAFF,
      payload: { name: 'Ola', username: 'villagestores' },
    });
    expect(user.statusCode, user.body).toBe(201);
    const signedIn = await harness.app.inject({
      method: 'POST',
      url: '/business/sign-in',
      payload: { username: 'villagestores', password: user.json().password as string },
    });
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    const headers = { 'x-business-token': signedIn.json().token as string };
    const saved = await harness.app.inject({
      method: 'POST',
      url: '/partner/profile',
      headers,
      payload: { convenience: false, specialities: ['Polish', 'Eastern European'] },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().shop).toEqual(
      expect.objectContaining({
        section: 'shops',
        specialities: ['Polish', 'Eastern European'],
        convenience: false,
      }),
    );
    const dashboard = (
      await harness.app.inject({ method: 'GET', url: '/partner/dashboard', headers })
    ).json();
    expect(dashboard.shop.specialities).toEqual(['Polish', 'Eastern European']);
    expect(names(await shops('?section=shops&speciality=Polish'))).toEqual(['Village Stores']);
    const refused = await harness.app.inject({
      method: 'POST',
      url: '/partner/profile',
      headers,
      payload: { about: 'We also arrange payday loans.' },
    });
    expect(refused.statusCode).toBe(400);
  });

  it('marks the obvious convenience store in the seed file, and not the supermarkets', async () => {
    const seed = loadShopsSeed();
    expect(seed.filter((shop) => shop.convenience)).toHaveLength(1);
    await seedShops(harness.repository, seed, harness.now);
    const convenience = await shops('?section=convenience');
    expect(convenience.shops).toHaveLength(1);
    expect((await shops('?section=shops')).shops).toHaveLength(seed.length - 1);
  });
});
