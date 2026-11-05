/**
 * The Shop Partner catalogue, built the way the professionals build it (ruling 96, 5 November
 * 2026): three packages with their limits, full editing, variants, photos looked at as they
 * arrive and kept in object storage or the database, the taxonomy's required details, a Pro
 * shop's CSV upload, Pro products first in the queue, a lapsed package hiding but never deleting,
 * Pro bought like Plus, and the mark-up still on every price a Shopper sees.
 */

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it } from 'vitest';

import type { OziBrain, ProductReading } from '../src/lib/language-model.js';
import { makeDerivatives, measurePhoto, testPicture } from '../src/lib/photo-quality.js';
import { spacesPhotoStore, spacesSettingsFrom, type S3Like } from '../src/lib/photo-store.js';
import { checkPartnerProduct } from '../src/services/auto-check.js';
import { inReadingOrder } from '../src/services/owner-desk.js';
import { parseCsv } from '../src/services/partner-catalogue.js';
import { partnerCatalogueForVoice } from '../src/services/owner-voice.js';
import { buildTestApp, STAFF, type TestAppOptions, type TestHarness } from './helpers.js';

let harness: TestHarness;
const START = new Date('2026-11-05T10:00:00.000Z');

afterEach(async () => {
  await harness?.close();
});

async function start(options: TestAppOptions = {}) {
  harness = await buildTestApp(START, options);
}

function staff(method: 'GET' | 'POST', url: string, payload?: object) {
  return harness.app.inject({ method, url, headers: STAFF, ...(payload ? { payload } : {}) });
}

let shopCount = 0;

/** A shop added by staff on a package, signed in. */
async function shopOn(
  plan: 'free' | 'plus' | 'pro',
  extra: Record<string, unknown> = {},
  kind: 'shop' | 'food' | 'service' = 'shop',
) {
  shopCount += 1;
  const paidMonths = plan === 'free' ? 0 : 1;
  const shop = (
    await staff('POST', '/staff/partners', {
      name: `Shop ${shopCount}`,
      about: 'Groceries.',
      kind,
      plan,
      paidMonths,
      ...extra,
    })
  ).json().shop as { id: string };
  const user = (
    await staff('POST', `/staff/partners/${shop.id}/users`, {
      name: 'Bola',
      username: `shop${shopCount}`,
    })
  ).json() as { password: string };
  const username = `shop${shopCount}`;
  const signIn = async () => {
    const signedIn = await harness.app.inject({
      method: 'POST',
      url: '/business/sign-in',
      payload: { username, password: user.password },
    });
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    return { 'x-business-token': signedIn.json().token as string };
  };
  return { shop, headers: await signIn(), signIn };
}

async function picture(options: Parameters<typeof testPicture>[0] = { width: 1200, height: 900, checkered: true }) {
  return (await testPicture(options)).toString('base64');
}

function add(headers: Record<string, string>, payload: Record<string, unknown>) {
  return harness.app.inject({ method: 'POST', url: '/partner/products', headers, payload });
}

async function approveAll() {
  for (const product of await harness.repository.partnerProducts.listPending()) {
    const decided = await staff('POST', `/staff/partner-products/${product.id}/decide`, {
      approve: true,
    });
    expect(decided.statusCode, decided.body).toBe(200);
  }
}

function clearBrain(reading: Partial<ProductReading> = {}): OziBrain {
  return {
    name: 'model',
    model: 'stand-in',
    understand: async () => null,
    checkProduct: async () => ({
      verdict: 'allowed',
      offensive: false,
      photoMatches: true,
      priceSensible: true,
      concern: null,
      confidence: 0.95,
      ...reading,
    }),
  };
}

describe('the three packages', () => {
  it('shows what each gives, which one the shop is on, and the figures from config', async () => {
    await start();
    const { headers } = await shopOn('free');
    const plan = (await harness.app.inject({ method: 'GET', url: '/partner/dashboard', headers }))
      .json().plan;
    expect(plan.limits).toEqual(
      expect.objectContaining({ products: 10, photosPerProduct: 1, variants: false, bulkAdd: false }),
    );
    expect(plan.packages.map((row: { tier: string; name: string; monthlyPence: number }) => [row.tier, row.name, row.monthlyPence])).toEqual([
      ['free', 'Free listing', 0],
      ['plus', 'Shop Partner Plus', 1499],
      ['pro', 'Shop Partner Pro', 2999],
    ]);
    expect(plan.packages[0]).toEqual(expect.objectContaining({ current: true, action: 'none' }));
    expect(plan.packages[1]).toEqual(expect.objectContaining({ current: false, action: 'start' }));
    expect(plan.packages[2].gives).toEqual(
      expect.arrayContaining([
        'Up to 3,000 products',
        '6 photos a product',
        'Add products from a spreadsheet (CSV), hundreds at a time',
        'Your new products are checked first',
      ]),
    );
    expect(plan.words).toMatch(/one photo each/);
    expect(plan.words).toMatch(/Shop Partner Pro, £29\.99 a month/);
  });

  it('caps each package at its products: Free 10, Plus 300, Pro 3,000', async () => {
    await start();
    const free = await shopOn('free');
    for (let n = 0; n < 10; n += 1) {
      expect((await add(free.headers, { name: `Thing ${n}`, pricePence: 100 + n })).statusCode).toBe(201);
    }
    const eleventh = await add(free.headers, { name: 'Thing 10', pricePence: 500 });
    expect(eleventh.statusCode).toBe(409);
    expect(eleventh.json().error.message).toMatch(
      /up to 10 products. Shop Partner Plus, £14\.99 a month.*carries 300; Shop Partner Pro, £29\.99 a month, carries 3000/,
    );
    const plus = await shopOn('plus');
    const pro = await shopOn('pro');
    expect((await harness.app.inject({ method: 'GET', url: '/partner/dashboard', headers: plus.headers })).json().plan.productLimit).toBe(300);
    expect((await harness.app.inject({ method: 'GET', url: '/partner/dashboard', headers: pro.headers })).json().plan.productLimit).toBe(3000);
  });
});

describe('photos', () => {
  it('a Free shop has one photo a product, Plus three, Pro six; beyond that is refused in plain words', async () => {
    await start();
    const free = await shopOn('free');
    const one = await add(free.headers, {
      name: 'Bananas',
      pricePence: 120,
      photos: [{ photo: await picture(), photoType: 'image/jpeg' }],
    });
    expect(one.statusCode, one.body).toBe(201);
    expect(one.json().product.photos).toHaveLength(1);
    expect(one.json().product.photos[0]).toEqual(
      expect.objectContaining({
        alt: 'Bananas',
        width: 1200,
        height: 900,
        thumb: expect.stringMatching(/\/photos\/.+\/thumb\/webp$/),
        mediumJpeg: expect.stringMatching(/\/medium\/jpg$/),
      }),
    );
    const two = await add(free.headers, {
      name: 'Apples',
      pricePence: 150,
      photos: [
        { photo: await picture(), photoType: 'image/jpeg' },
        { photo: await picture(), photoType: 'image/jpeg' },
      ],
    });
    expect(two.statusCode).toBe(400);
    expect(two.json().error.message).toMatch(/one photo a product. Shop Partner Plus carries 3, Shop Partner Pro 6/);
    // A second photo added afterwards is refused too, with the way up.
    const more = await harness.app.inject({
      method: 'POST',
      url: `/partner/products/${one.json().product.id}/photos`,
      headers: free.headers,
      payload: { photo: await picture(), photoType: 'image/jpeg' },
    });
    expect(more.statusCode).toBe(409);
    expect(more.json().error.message).toMatch(/already has its photo/);

    const pro = await shopOn('pro');
    const six = await add(pro.headers, {
      name: 'Mangoes',
      pricePence: 300,
      photos: await Promise.all(
        Array.from({ length: 6 }, async () => ({ photo: await picture(), photoType: 'image/jpeg' })),
      ),
    });
    expect(six.statusCode, six.body).toBe(201);
    expect(six.json().product.photos).toHaveLength(6);
    // Nine pictures made in three sizes each: more than five seconds on a busy machine.
  }, 30_000);

  it('is looked at as it arrives: refused when too small or not a picture, warned when dark, bright or blurry', async () => {
    await start();
    const { headers } = await shopOn('plus');
    const tiny = await add(headers, {
      name: 'Tiny',
      pricePence: 100,
      photos: [{ photo: await picture({ width: 400, height: 300, checkered: true }), photoType: 'image/jpeg' }],
    });
    expect(tiny.statusCode).toBe(400);
    expect(tiny.json().error.message).toMatch(/too small to show clearly \(400 pixels/);
    const junk = await add(headers, {
      name: 'Junk',
      pricePence: 100,
      photos: [{ photo: Buffer.from('not a picture').toString('base64'), photoType: 'image/jpeg' }],
    });
    expect(junk.statusCode).toBe(400);
    expect(junk.json().error.message).toMatch(/could not be read/);

    const dark = await add(headers, {
      name: 'Dark',
      pricePence: 100,
      photos: [{ photo: await picture({ width: 1200, height: 900, grey: 20, checkered: true }), photoType: 'image/jpeg' }],
    });
    expect(dark.statusCode, dark.body).toBe(201);
    expect(dark.json().photoNotes).toEqual(['That photo is too dark. Try it near a window.']);
    expect(dark.json().message).toMatch(/too dark. Try it near a window/);
    const bright = await add(headers, {
      name: 'Bright',
      pricePence: 100,
      photos: [{ photo: await picture({ width: 1200, height: 900, grey: 240, checkered: true }), photoType: 'image/jpeg' }],
    });
    expect(bright.json().photoNotes).toEqual(['That photo is too bright. Move it out of direct light.']);
    const blurry = await add(headers, {
      name: 'Blurry',
      pricePence: 100,
      photos: [{ photo: await picture({ width: 1200, height: 900, checkered: true, blurred: true }), photoType: 'image/jpeg' }],
    });
    expect(blurry.json().photoNotes).toEqual(['That photo is blurry. Hold the phone still, then try again.']);
    const small = await add(headers, {
      name: 'Small',
      pricePence: 100,
      photos: [{ photo: await picture({ width: 700, height: 500, checkered: true }), photoType: 'image/jpeg' }],
    });
    expect(small.json().photoNotes[0]).toMatch(/small \(700 pixels/);
    const fine = await add(headers, {
      name: 'Fine',
      pricePence: 100,
      photos: [{ photo: await picture(), photoType: 'image/jpeg' }],
    });
    expect(fine.json().photoNotes).toEqual([]);
  });

  it('makes three sizes as WebP with a JPEG beside each, never enlarging', async () => {
    const small = await testPicture({ width: 1000, height: 600, checkered: true });
    const rules = harness?.config.catalogue.photos ?? (await (async () => {
      await start();
      return harness.config.catalogue.photos;
    })());
    const made = await makeDerivatives(small, rules);
    expect(made.map((d) => `${d.size}/${d.format}:${d.width}x${d.height}`)).toEqual([
      'thumb/webp:320x192',
      'thumb/jpeg:320x192',
      'medium/webp:800x480',
      'medium/jpeg:800x480',
      'full/webp:1000x600',
      'full/jpeg:1000x600',
    ]);
    expect(made.every((d) => d.bytes.length > 0)).toBe(true);
    const measured = await measurePhoto(small);
    expect(measured.width).toBe(1000);
    expect(measured.sharpness).toBeGreaterThan(rules.blurBelow);
  });

  it('keeps photos in the database when Spaces is not set up, and serves them through the API', async () => {
    await start();
    const { shop, headers } = await shopOn('plus');
    const added = await add(headers, {
      name: 'Bread',
      pricePence: 200,
      photos: [{ photo: await picture(), photoType: 'image/jpeg' }],
    });
    expect(added.statusCode, added.body).toBe(201);
    const photo = added.json().product.photos[0];
    const row = await harness.repository.partnerProductPhotos.findById(photo.id);
    expect(row).toEqual(expect.objectContaining({ storage: 'db', position: 0 }));
    expect((await harness.repository.storedFiles.get(row!.thumbKey))?.contentType).toBe('image/webp');
    expect((await harness.repository.storedFiles.get(row!.fullKey.replace(/\.webp$/, '.jpg')))?.contentType).toBe('image/jpeg');
    // Its own shop sees it before approval, through the partner route.
    const mine = await harness.app.inject({ method: 'GET', url: photo.medium, headers });
    expect(mine.statusCode).toBe(200);
    expect(mine.headers['content-type']).toBe('image/webp');
    // Shoppers see it only once approved, through the shop route, cached a day.
    await approveAll();
    const page = (await harness.app.inject({ method: 'GET', url: `/shops/${shop.id}` })).json();
    const shown = page.products[0].photos[0];
    expect(shown.full).toBe(`/shops/${shop.id}/products/${added.json().product.id}/photos/${photo.id}/full/webp`);
    const served = await harness.app.inject({ method: 'GET', url: shown.fullJpeg });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.headers['cache-control']).toBe('public, max-age=86400');
    // The old cover route still answers, with the medium JPEG.
    const cover = await harness.app.inject({
      method: 'GET',
      url: `/shops/${shop.id}/products/${added.json().product.id}/photo`,
    });
    expect(cover.headers['content-type']).toBe('image/jpeg');
    // Taking a photo off removes every file.
    const removed = await harness.app.inject({
      method: 'POST',
      url: `/partner/products/${added.json().product.id}/photos/${photo.id}/remove`,
      headers,
      payload: {},
    });
    expect(removed.statusCode).toBe(200);
    expect(await harness.repository.storedFiles.get(row!.thumbKey)).toBeNull();
    expect(await harness.repository.partnerProductPhotos.listForProduct(added.json().product.id)).toEqual([]);
  });

  it('puts photos in Spaces with the S3 client when set up, and gives the CDN address', async () => {
    const objects = new Map<string, { body: Uint8Array; type: string }>();
    const calls: string[] = [];
    const s3: S3Like = {
      async send(command) {
        calls.push(command.constructor.name);
        if (command instanceof PutObjectCommand) {
          objects.set(command.input.Key as string, {
            body: command.input.Body as Uint8Array,
            type: command.input.ContentType as string,
          });
          expect(command.input.Bucket).toBe('ozi-photos');
          expect(command.input.ACL).toBe('public-read');
          return {};
        }
        if (command instanceof GetObjectCommand) {
          const found = objects.get(command.input.Key as string);
          if (!found) throw Object.assign(new Error('gone'), { name: 'NoSuchKey' });
          return { Body: found.body, ContentType: found.type };
        }
        if (command instanceof DeleteObjectCommand) {
          objects.delete(command.input.Key as string);
          return {};
        }
        throw new Error('unexpected command');
      },
    };
    const settings = spacesSettingsFrom({
      spacesKey: 'DO00KEY',
      spacesSecret: 'secret',
      spacesBucket: 'ozi-photos',
      spacesRegion: 'lon1',
      spacesEndpoint: 'lon1.digitaloceanspaces.com',
      spacesCdnUrl: 'https://ozi-photos.lon1.cdn.digitaloceanspaces.com/',
    });
    expect(settings).toEqual(
      expect.objectContaining({
        endpoint: 'https://lon1.digitaloceanspaces.com',
        cdnUrl: 'https://ozi-photos.lon1.cdn.digitaloceanspaces.com',
      }),
    );
    // Without all five, nothing: the database is used.
    expect(spacesSettingsFrom({ ...settings!, spacesKey: undefined } as never)).toBeNull();
    await start({ photoStore: spacesPhotoStore(settings!, s3) });
    const { shop, headers } = await shopOn('plus');
    const added = await add(headers, {
      name: 'Cheese',
      pricePence: 450,
      photos: [{ photo: await picture(), photoType: 'image/jpeg' }],
    });
    expect(added.statusCode, added.body).toBe(201);
    expect(objects.size).toBe(6);
    expect([...objects.keys()].every((key) => key.startsWith(`partner-products/${added.json().product.id}/`))).toBe(true);
    const photo = added.json().product.photos[0];
    expect(photo.thumb).toMatch(/^https:\/\/ozi-photos\.lon1\.cdn\.digitaloceanspaces\.com\/partner-products\/.+-thumb\.webp$/);
    expect(photo.fullJpeg).toMatch(/-full\.jpg$/);
    expect((await harness.repository.partnerProductPhotos.findById(photo.id))?.storage).toBe('spaces');
    await approveAll();
    const page = (await harness.app.inject({ method: 'GET', url: `/shops/${shop.id}` })).json();
    expect(page.products[0].photos[0].medium).toMatch(/^https:\/\/ozi-photos\.lon1\.cdn/);
    // Nothing went to the database.
    expect(await harness.repository.storedFiles.get([...objects.keys()][0]!)).toBeNull();
    const removed = await harness.app.inject({
      method: 'POST',
      url: `/partner/products/${added.json().product.id}/photos/${photo.id}/remove`,
      headers,
      payload: {},
    });
    expect(removed.statusCode).toBe(200);
    expect(objects.size).toBe(0);
    expect(calls.filter((name) => name === 'DeleteObjectCommand')).toHaveLength(6);
  });
});

describe('the catalogue details', () => {
  it('files a product under a category and asks for what the category requires', async () => {
    await start();
    const { headers } = await shopOn('plus');
    const noUnit = await add(headers, { name: 'Milk', pricePence: 120, categoryId: 'dairy-eggs' });
    expect(noUnit.statusCode).toBe(400);
    expect(noUnit.json().error.message).toMatch(/Dairy and eggs needs the size/);
    expect(noUnit.json().error.message).toMatch(/needs the allergens/);
    const wrongCategory = await add(headers, { name: 'Milk', pricePence: 120, categoryId: 'mains' });
    expect(wrongCategory.json().error.message).toMatch(/choose a category from the list: Fruit and vegetables/);
    const badAllergen = await add(headers, {
      name: 'Milk',
      pricePence: 120,
      categoryId: 'dairy-eggs',
      unitQuantity: 2,
      unitKind: 'l',
      allergens: ['Lactose'],
    });
    expect(badAllergen.json().error.message).toMatch(/Lactose is not on the list of fourteen allergens/);
    const halfUnit = await add(headers, { name: 'Milk', pricePence: 120, unitQuantity: 2 });
    expect(halfUnit.json().error.message).toMatch(/quantity and a unit together/);
    const good = await add(headers, {
      name: 'Milk',
      pricePence: 120,
      categoryId: 'dairy-eggs',
      unitQuantity: 2,
      unitKind: 'l',
      allergens: ['milk'],
      description: 'Whole milk from a Kent farm.',
    });
    expect(good.statusCode, good.body).toBe(201);
    expect(good.json().product).toEqual(
      expect.objectContaining({
        category: { id: 'dairy-eggs', name: 'Dairy and eggs' },
        description: 'Whole milk from a Kent farm.',
        allergens: ['Milk'],
        allergenWords: 'Contains milk',
        unit: expect.objectContaining({ quantity: 2, unit: 'l', quantityWords: '2 l', perPence: 60, per: 'litre', words: '£0.60 per litre' }),
      }),
    );
    const tooLong = await add(headers, { name: 'Essay', pricePence: 100, description: 'x'.repeat(601) });
    expect(tooLong.json().error.message).toMatch(/up to 600 characters/);
  });

  it('is edited in full, a change of name checked again, a change of price applied at once', async () => {
    await start({ brain: clearBrain() });
    const { shop, headers } = await shopOn('plus', { agreedMarkupPercent: 50 });
    const added = await add(headers, { name: 'Bananas', pricePence: 100, tags: 'fruit' });
    expect(added.json().product.status).toBe('approved');
    const item = await harness.repository.catalogue.findById(added.json().product.catalogueItemId);
    expect(item?.estimatedPricePence).toBe(150);
    const edited = await harness.app.inject({
      method: 'POST',
      url: `/partner/products/${added.json().product.id}`,
      headers,
      payload: {
        name: 'Fairtrade bananas',
        description: 'Ripe and ready.',
        categoryId: 'fruit-veg',
        unitQuantity: 5,
        unitKind: 'each',
        pricePence: 125,
        allergens: [],
        expiresOn: '2026-11-12',
      },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().product).toEqual(
      expect.objectContaining({
        name: 'Fairtrade bananas',
        pricePence: 125,
        allergens: [],
        allergenWords: 'No listed allergens',
        unit: expect.objectContaining({ words: '£0.25 each' }),
      }),
    );
    const after = await harness.repository.catalogue.findById(added.json().product.catalogueItemId);
    // The catalogue keeps the marked-up price (50% on 125p is 188p) and the new name.
    expect(after).toEqual(
      expect.objectContaining({ name: expect.stringMatching(/^Fairtrade bananas \(Shop \d+\)$/), estimatedPricePence: 188 }),
    );
    // The Shopper's page shows the marked-up price and the unit price worked from it; never 125.
    const page = (await harness.app.inject({ method: 'GET', url: `/shops/${shop.id}` })).json();
    expect(page.products[0].pricePence).toBe(188);
    expect(page.products[0].unit.words).toBe('£0.38 each');
    expect(JSON.stringify(page)).not.toContain('"pricePence":125');
    expect(page.shop).not.toHaveProperty('agreedMarkupPercent');
    const refused = await harness.app.inject({
      method: 'POST',
      url: `/partner/products/${added.json().product.id}`,
      headers,
      payload: { name: 'Lager' },
    });
    expect(refused.statusCode).toBe(400);
  });

  it('groups sizes and packs of one product as variants, on Plus and Pro only', async () => {
    await start();
    const free = await shopOn('free');
    const parent = await add(free.headers, { name: 'Rice', pricePence: 200 });
    const noVariants = await add(free.headers, {
      name: 'Rice',
      pricePence: 700,
      variantOf: parent.json().product.id,
      variantLabel: '5 kg',
    });
    expect(noVariants.statusCode).toBe(400);
    expect(noVariants.json().error.message).toMatch(/come with Shop Partner Plus and Shop Partner Pro/);

    const plus = await shopOn('plus');
    const kilo = await add(plus.headers, { name: 'Rice', pricePence: 200, unitQuantity: 1, unitKind: 'kg' });
    const noLabel = await add(plus.headers, { name: 'Rice', pricePence: 700, variantOf: kilo.json().product.id });
    expect(noLabel.json().error.message).toMatch(/which size or pack/);
    const big = await add(plus.headers, {
      name: 'Rice',
      pricePence: 700,
      variantOf: kilo.json().product.id,
      variantLabel: '5 kg',
      unitQuantity: 5,
      unitKind: 'kg',
    });
    expect(big.statusCode, big.body).toBe(201);
    expect(big.json().product).toEqual(
      expect.objectContaining({ variantGroupId: kilo.json().product.id, variantLabel: '5 kg' }),
    );
    expect((await harness.repository.partnerProducts.findById(kilo.json().product.id))?.variantGroupId).toBe(kilo.json().product.id);
    // The same size twice is "already added"; a different size of the same name is not.
    expect((await add(plus.headers, { name: 'Rice', pricePence: 700, variantOf: kilo.json().product.id, variantLabel: '5 kg' })).statusCode).toBe(409);
    await approveAll();
    const page = (await harness.app.inject({ method: 'GET', url: `/shops/${plus.shop.id}` })).json();
    expect(page.products.map((p: { variantGroupId: string; variantLabel: string | null }) => [p.variantGroupId, p.variantLabel])).toEqual([
      [kilo.json().product.id, null],
      [kilo.json().product.id, '5 kg'],
    ]);
    const approved = await harness.repository.partnerProducts.findById(big.json().product.id);
    const item = await harness.repository.catalogue.findById(approved!.catalogueItemId!);
    expect(item?.name).toMatch(/^Rice, 5 kg \(Shop \d+\)$/);
  });
});

describe('bulk add from a spreadsheet (Pro)', () => {
  const csv = [
    'name,price,category,unit quantity,unit,allergens,barcode,description',
    'Bananas,1.20,Fruit and vegetables,5,each,,,"Five ripe bananas, sold as a bunch."',
    'Milk,,Dairy and eggs,2,l,Milk,,',
    'Beans,0.60,Tins,400,g,none,5000000000001,',
    'Lager,2.50,Drinks,500,ml,none,,',
    'Rice,3.00,cupboard,1,kg,none,,Basmati',
    'Cake,2.00,Bakery,,,Eggs; Milk; Gluten,,',
  ].join('\n');

  it('reads CSV properly, quotes and all', () => {
    expect(parseCsv('a,b\n"c, d","e ""f"""\r\n\n')).toEqual([
      ['a', 'b'],
      ['c, d', 'e "f"'],
    ]);
  });

  it('is for Pro only, gives a template, and says what is wrong with each row', async () => {
    await start();
    const plus = await shopOn('plus');
    const refused = await harness.app.inject({
      method: 'POST',
      url: '/partner/products/bulk',
      headers: plus.headers,
      payload: { csv },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toMatch(/comes with Shop Partner Pro/);

    const pro = await shopOn('pro');
    const template = await harness.app.inject({ method: 'GET', url: '/partner/products/template.csv', headers: pro.headers });
    expect(template.headers['content-type']).toMatch(/text\/csv/);
    expect(template.body.split('\r\n')[0]).toBe(
      'name,price,category,unit quantity,unit,allergens,barcode,description',
    );
    const wrongHeader = await harness.app.inject({
      method: 'POST',
      url: '/partner/products/bulk',
      headers: pro.headers,
      payload: { csv: 'product,cost\nBananas,1.20' },
    });
    expect(wrongHeader.json().error.message).toMatch(/first line must be the template's columns/);
    const sent = await harness.app.inject({
      method: 'POST',
      url: '/partner/products/bulk',
      headers: pro.headers,
      payload: { csv },
    });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json()).toEqual(
      expect.objectContaining({ added: 2, failed: 4, message: expect.stringMatching(/2 added, 4 not/) }),
    );
    expect(sent.json().results).toEqual([
      { row: 2, ok: true, name: 'Bananas', status: 'pending' },
      { row: 3, ok: false, name: 'Milk', error: 'The price must be in pounds, such as 2.50.' },
      { row: 4, ok: false, name: 'Beans', error: expect.stringMatching(/"Tins" is not a category. Use one of: Fruit and vegetables/) },
      { row: 5, ok: false, name: 'Lager', error: expect.stringMatching(/never brings alcohol/) },
      { row: 6, ok: true, name: 'Rice', status: 'pending' },
      { row: 7, ok: false, name: 'Cake', error: expect.stringMatching(/Gluten is not on the list of fourteen allergens/) },
    ]);
    const products = await harness.repository.partnerProducts.listForShop(pro.shop.id);
    expect(products.map((p) => [p.name, p.categoryId, p.unitQuantity, p.unitKind, p.allergens, p.description])).toEqual(
      expect.arrayContaining([
        ['Bananas', 'fruit-veg', 5, 'each', [], 'Five ripe bananas, sold as a bunch.'],
        ['Rice', 'cupboard', 1, 'kg', [], 'Basmati'],
      ]),
    );
  });
});

describe('approval', () => {
  it('puts a Pro shop’s products first in the staff queue and on the owner’s desk', async () => {
    await start();
    const free = await shopOn('free');
    const pro = await shopOn('pro');
    const first = await add(free.headers, { name: 'Free loaf', pricePence: 100 });
    harness.setNow(new Date(START.getTime() + 60_000));
    const second = await add(pro.headers, { name: 'Pro loaf', pricePence: 200 });
    harness.setNow(new Date(START.getTime() + 120_000));
    const third = await add(free.headers, { name: 'Free cake', pricePence: 300 });
    const queue = (await staff('GET', '/staff/partner-products')).json().products;
    expect(queue.map((row: { name: string; priority: string; packageName: string }) => [row.name, row.priority, row.packageName])).toEqual([
      ['Pro loaf', 'high', 'Shop Partner Pro'],
      ['Free loaf', 'normal', 'Free listing'],
      ['Free cake', 'normal', 'Free listing'],
    ]);
    expect(queue[0]).toEqual(expect.objectContaining({ description: '', photos: [], shopKind: 'shop' }));
    // Without the model each one asked the owner; his desk reads the Pro one first.
    const matters = inReadingOrder(await harness.repository.ownerDesk.listUnsettled());
    expect(matters.map((m) => m.subjectId)).toEqual([
      second.json().product.id,
      first.json().product.id,
      third.json().product.id,
    ]);
    expect(matters[0]?.priority).toBe(1);
    // The owner's voice tool says the same, read-only.
    const summary = await partnerCatalogueForVoice(harness.app.ctx);
    expect(summary).toEqual(
      expect.objectContaining({
        waiting: 3,
        byPackage: { 'Free listing': 2, 'Shop Partner Plus': 0, 'Shop Partner Pro': 1 },
        live: 0,
      }),
    );
    expect(summary.words).toMatch(/3 products from shops are waiting.*2 from Free listing shops, 1 from Shop Partner Pro shops.*Pro shops' products are checked first/);
  });

  it('a clear product with a clear photo and a sensible price is approved by itself, and a changed photo is checked again', async () => {
    await start({ brain: clearBrain() });
    const { headers } = await shopOn('plus');
    const added = await add(headers, {
      name: 'Oranges',
      pricePence: 180,
      photos: [{ photo: await picture(), photoType: 'image/jpeg' }],
    });
    expect(added.json().product.status).toBe('approved');
    expect(added.json().message).toMatch(/checked and listed/);
    const photo = added.json().product.photos[0];
    // Another photo: the check runs again on the cover; the stand-in is happy.
    const more = await harness.app.inject({
      method: 'POST',
      url: `/partner/products/${added.json().product.id}/photos`,
      headers,
      payload: { photo: await picture(), photoType: 'image/jpeg' },
    });
    expect(more.statusCode, more.body).toBe(201);
    const cover = await harness.app.inject({
      method: 'POST',
      url: `/partner/products/${added.json().product.id}/photos/${more.json().photo.id}/cover`,
      headers,
      payload: {},
    });
    expect(cover.statusCode).toBe(200);
    const rows = await harness.repository.partnerProductPhotos.listForProduct(added.json().product.id);
    expect(rows.map((row) => row.id)).toEqual([more.json().photo.id, photo.id]);
    await checkPartnerProduct(harness.app.ctx, added.json().product.id, undefined, { edited: true });
    expect((await harness.repository.partnerProducts.findById(added.json().product.id))?.status).toBe('approved');
  });
});

describe('a lapsed package', () => {
  it('hides products beyond the free limit and photos beyond one, deletes nothing, and comes back when paid', async () => {
    await start({ brain: clearBrain() });
    const { shop, headers: first, signIn } = await shopOn('plus');
    let headers = first;
    for (let n = 0; n < 12; n += 1) {
      harness.setNow(new Date(START.getTime() + n * 1000));
      const added = await add(headers, {
        name: `Thing ${n}`,
        pricePence: 100 + n,
        photos:
          n === 0
            ? [
                { photo: await picture(), photoType: 'image/jpeg' },
                { photo: await picture(), photoType: 'image/jpeg' },
              ]
            : [],
      });
      expect(added.statusCode, added.body).toBe(201);
    }
    const paid = (await harness.app.inject({ method: 'GET', url: `/shops/${shop.id}` })).json();
    expect(paid.products).toHaveLength(12);
    expect(paid.products[0].photos).toHaveLength(2);
    // A month and a day later, unpaid (and signed in afresh, a sign-in being shorter than that).
    harness.setNow(new Date('2026-12-07T10:00:00.000Z'));
    headers = await signIn();
    const lapsed = (await harness.app.inject({ method: 'GET', url: `/shops/${shop.id}` })).json();
    expect(lapsed.products).toHaveLength(10);
    expect(lapsed.products.map((p: { name: string }) => p.name)).toEqual(
      Array.from({ length: 10 }, (_, n) => `Thing ${n}`),
    );
    expect(lapsed.products[0].photos).toHaveLength(1);
    expect(lapsed.shop.packageName).toBe('Free listing');
    const hidden = await harness.app.inject({
      method: 'GET',
      url: `/shops/${shop.id}/products/${paid.products[11].id}/photo`,
    });
    expect(hidden.statusCode).toBe(404);
    // The shop's own dashboard still has all twelve, with both photos; nothing is deleted.
    const dashboard = (await harness.app.inject({ method: 'GET', url: '/partner/dashboard', headers })).json();
    expect(dashboard.products).toHaveLength(12);
    expect(dashboard.products.find((p: { name: string }) => p.name === 'Thing 0').photos).toHaveLength(2);
    expect(dashboard.plan.words).toMatch(/not paid at the moment, so only your first 10 products show, each with one photo. Nothing is deleted/);
    expect((await add(headers, { name: 'Thing 12', pricePence: 500 })).statusCode).toBe(409);
    // Paid again: everything is back.
    await staff('POST', `/staff/partners/${shop.id}`, { kind: 'plan', paidMonths: 1 });
    const back = (await harness.app.inject({ method: 'GET', url: `/shops/${shop.id}` })).json();
    expect(back.products).toHaveLength(12);
    expect(back.products[0].photos).toHaveLength(2);
  });
});

describe('Shop Partner Pro, paid like Plus', () => {
  it('starts with the first month free, is renewed through Stripe, and a Preferred Partner pays the difference', async () => {
    await start();
    const { headers, shop } = await shopOn('free');
    const free = await harness.app.inject({
      method: 'POST',
      url: '/partner/plan/checkout',
      headers,
      payload: { kind: 'pro' },
    });
    expect(free.statusCode, free.body).toBe(200);
    expect(free.json().url).toBeNull();
    expect(free.json().message).toMatch(/Shop Partner Pro is on, and your first month is free/);
    expect(free.json().message).toMatch(/£29\.99 a month/);
    let dashboard = (await harness.app.inject({ method: 'GET', url: '/partner/dashboard', headers })).json();
    expect(dashboard.plan).toEqual(
      expect.objectContaining({ tier: 'pro', paid: true, productLimit: 3000, firstMonthFree: false }),
    );
    expect(dashboard.plan.limits.bulkAdd).toBe(true);
    expect(dashboard.payments[0]).toEqual(expect.objectContaining({ what: 'Shop Partner Pro', amountPence: 0 }));
    expect(dashboard.plan.packages[2]).toEqual(expect.objectContaining({ current: true, action: 'renew' }));

    const renew = await harness.app.inject({
      method: 'POST',
      url: '/partner/plan/checkout',
      headers,
      payload: { kind: 'pro', months: 2 },
    });
    expect(renew.statusCode, renew.body).toBe(200);
    expect(renew.json().message).toMatch(/Taking you to pay £59\.98 for Shop Partner Pro/);
    const link = harness.payments.calls.find((call) => call.kind === 'payment_link');
    expect(link?.input).toEqual(
      expect.objectContaining({
        purpose: 'partner',
        amountPence: 5998,
        description: expect.stringMatching(/Shop Partner Pro for Shop \d+, 2 months/),
      }),
    );
    const sessionId = String(renew.json().url).split('/').pop();
    const confirmed = await harness.app.inject({
      method: 'POST',
      url: '/partner/plan/confirm',
      headers,
      payload: { receipt: renew.json().receipt, sessionId },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().message).toMatch(/Shop Partner Pro is paid, £59\.98/);
    dashboard = (await harness.app.inject({ method: 'GET', url: '/partner/dashboard', headers })).json();
    expect(dashboard.plan.paidUntil).toBe('2027-02-05T10:00:00.000Z');
    expect(dashboard.payments).toHaveLength(2);
    // Listed like a paid Plus shop: above free ones.
    const list = (await harness.app.inject({ method: 'GET', url: '/shops' })).json();
    expect(list.shops.find((row: { id: string }) => row.id === shop.id).partnerPlus).toBe(true);

    // A Preferred Partner (a restaurant at 20% off) has Plus free, and Pro for the difference.
    const cafe = await shopOn('free', { agreedDiscountPercent: 20 }, 'food');
    const cafeDashboard = (await harness.app.inject({ method: 'GET', url: '/partner/dashboard', headers: cafe.headers })).json();
    expect(cafeDashboard.plan.packages[2]).toEqual(expect.objectContaining({ tier: 'pro', payPence: 1500, action: 'upgrade' }));
    const cafePro = await harness.app.inject({
      method: 'POST',
      url: '/partner/plan/checkout',
      headers: cafe.headers,
      payload: { kind: 'pro' },
    });
    expect(cafePro.statusCode, cafePro.body).toBe(200);
    expect(cafePro.json().message).toMatch(/first month is free.*£15\.00 a month/);
    // Plus itself is still nothing to pay for a restaurant.
    const cafePlus = await harness.app.inject({
      method: 'POST',
      url: '/partner/plan/checkout',
      headers: cafe.headers,
      payload: { kind: 'plan' },
    });
    expect(cafePlus.statusCode).toBe(400);
    expect(cafePlus.json().error.message).toMatch(/no monthly fee and no commission.*Shop Partner Pro for £15\.00 a month/);
  });

  it('a Pro shop orders its page: featured first, then its own order; other packages are told', async () => {
    await start({ brain: clearBrain() });
    const plus = await shopOn('plus');
    const a = await add(plus.headers, { name: 'Apples', pricePence: 100 });
    const featuredRefused = await harness.app.inject({
      method: 'POST',
      url: `/partner/products/${a.json().product.id}/featured`,
      headers: plus.headers,
      payload: { featured: true },
    });
    expect(featuredRefused.statusCode).toBe(400);
    expect(featuredRefused.json().error.message).toMatch(/Featured products come with Shop Partner Pro/);

    const pro = await shopOn('pro');
    const ids: string[] = [];
    for (const name of ['One', 'Two', 'Three']) {
      harness.setNow(new Date(START.getTime() + ids.length * 1000));
      ids.push((await add(pro.headers, { name, pricePence: 100 })).json().product.id);
    }
    expect((await harness.app.inject({ method: 'POST', url: '/partner/products/order', headers: pro.headers, payload: { ids: [ids[2], ids[0], ids[1]] } })).statusCode).toBe(200);
    expect((await harness.app.inject({ method: 'POST', url: `/partner/products/${ids[1]}/featured`, headers: pro.headers, payload: { featured: true } })).statusCode).toBe(200);
    const page = (await harness.app.inject({ method: 'GET', url: `/shops/${pro.shop.id}` })).json();
    expect(page.products.map((p: { name: string }) => p.name)).toEqual(['Two', 'Three', 'One']);
    expect(page.products[0].featured).toBe(true);
    expect(page.shop.featuredOrdering).toBe(true);
  });
});
