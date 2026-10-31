/**
 * Applying to be an Ozi Ambassador (Anthony, 30 October 2026): the application in place of the
 * instant opt-in, its statuses, the documents and the automatic check of the photo ID and the
 * proof of address, the owner told when the documents are in, the staff Ambassadors page and who
 * may open it, grandfathering, the gate on the Toolkit and withdrawals, "Sign up this business
 * now" with the owner's agreement and the agreement sheet's reference, the "introduced by" code
 * at sign-up, and how long the documents are kept.
 */

import { AMBASSADOR_TERMS_VERSION } from '@aldilivery/core';
import { afterEach, describe, expect, it } from 'vitest';

import type { DocumentCheckInput, DocumentReading, OziBrain } from '../src/lib/language-model.js';
import { sweepAmbassadorRetention } from '../src/services/ambassador-applications.js';
import { becomeAmbassador } from '../src/services/ambassadors.js';
import {
  buildTestApp,
  signUpShopper,
  STAFF,
  type TestHarness,
  type TestAppOptions,
} from './helpers.js';

let harness: TestHarness;

afterEach(async () => {
  await harness?.close();
});

const START = new Date('2026-11-10T10:00:00.000Z');
const PHOTO = Buffer.from('a pretend photo of a document').toString('base64');
const PDF = Buffer.from('%PDF-1.4 a pretend council tax letter').toString('base64');

async function build(options: TestAppOptions = {}) {
  harness = await buildTestApp(START, options);
}

function get(url: string, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'GET', url, headers });
}

function post(url: string, payload: object, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}

/** Everything clear: the right kind, readable, in date, the account's name, a recent letter. */
function clearReading(input: DocumentCheckInput): DocumentReading {
  return {
    kindMatches: true,
    readable: true,
    nameOnDocument:
      input.kind === 'face_photo' || input.kind === 'ambassador_card_back'
        ? null
        : 'OBI, ADA NGOZI',
    expiresOn: input.kind === 'ambassador_passport' ? '2031-05-01' : null,
    dbsRecordsSomething: null,
    clearRealFace: input.kind === 'face_photo' ? true : null,
    // The face compared with the ID only when the ID is given: only with consent (31 October).
    samePerson: input.kind === 'face_photo' && input.idPhoto ? true : null,
    concern: null,
    confidence: 0.97,
    issuedOn: input.kind === 'ambassador_proof_of_address' ? '2026-10-01' : null,
  };
}

function standInBrain(
  document: (input: DocumentCheckInput) => DocumentReading | null = clearReading,
): OziBrain & { asked: DocumentCheckInput[] } {
  const asked: DocumentCheckInput[] = [];
  return {
    name: 'model',
    model: 'stand-in',
    asked,
    understand: async () => null,
    checkDocument: async (input) => {
      asked.push(input);
      return document(input);
    },
  };
}

async function applicant(name = 'Ada Obi', phone = '+447700900500') {
  const shopper = await signUpShopper(harness, { displayName: name, phone });
  const handle = (await harness.repository.shoppers.findById(shopper.shopperId))!.handle;
  return { ...shopper, handle, via: `shopper:${handle}` };
}

async function agree(headers: Record<string, string>) {
  const joined = await post(
    '/ambassador/join',
    { termsAgreed: true, termsVersion: AMBASSADOR_TERMS_VERSION },
    headers,
  );
  expect(joined.statusCode, joined.body).toBe(200);
  return joined.json();
}

function sendDocument(headers: Record<string, string>, payload: object) {
  return post('/ambassador/documents', payload, headers);
}

/** A passport, a council tax letter as a PDF and a face photo: everything needed. */
async function sendEverything(headers: Record<string, string>, faceConsent = true) {
  const consent = await post('/ambassador/face-consent', { consent: faceConsent }, headers);
  expect(consent.statusCode, consent.body).toBe(200);
  for (const payload of [
    { kind: 'photo_id_front', idType: 'passport', image: PHOTO, contentType: 'image/jpeg' },
    {
      kind: 'proof_of_address',
      addressType: 'council_tax',
      image: PDF,
      contentType: 'application/pdf',
    },
    { kind: 'face_photo', image: PHOTO, contentType: 'image/jpeg' },
  ]) {
    const sent = await sendDocument(headers, payload);
    expect(sent.statusCode, sent.body).toBe(201);
  }
}

async function agreementOf(shopperId: string) {
  return (await harness.repository.ambassadors.findAgreement('shopper', shopperId))!;
}

async function staffToken(role: string, username: string): Promise<Record<string, string>> {
  const made = (await post('/staff/team', { name: username, username, role }, STAFF)).json() as {
    password: string;
  };
  const token = (await post('/staff/sign-in', { username, password: made.password })).json()
    .token as string;
  return { 'x-staff-token': token };
}

let shopCount = 0;

async function joinShop(details: Record<string, unknown> = {}) {
  shopCount += 1;
  const joined = await post('/partner/join', {
    name: `Corner Shop ${shopCount}`,
    kind: 'shop',
    address: '12 High Street, Gillingham',
    postcode: 'ME7 1AA',
    hours: 'Monday to Saturday 7am to 5pm',
    contactName: 'Bola',
    mobile: `07700 900 ${String(700 + shopCount)}`,
    email: `shop${shopCount}@example.com`,
    username: `cornershop${shopCount}`,
    password: 'a-long-enough-password',
    termsAgreed: true,
    ...details,
  });
  expect(joined.statusCode, joined.body).toBe(201);
  return joined.json() as { shop: { id: string }; message: string };
}

/** Agreed, documents in and checked, the chat recorded, and approved by the founder. */
async function approvedAmbassador() {
  const ada = await applicant();
  await agree(ada.authHeader);
  const agreement = await agreementOf(ada.shopperId);
  await harness.repository.ambassadors.updateAgreement(agreement.id, {
    status: 'approved',
    approvedAt: harness.now(),
  });
  return ada;
}

describe('applying to be an Ozi Ambassador', () => {
  it('moves through applied, documents sent, documents checked, chat done and approved, and only then gives the link', async () => {
    await build({ brain: standInBrain() });
    const ada = await applicant();

    // Agreeing to the terms is applying: no link yet.
    const joined = await agree(ada.authHeader);
    expect(joined.link).toBeNull();
    expect(joined.message).toMatch(/Next, please send your documents/);
    expect(joined.application).toEqual(
      expect.objectContaining({ status: 'applied', statusWords: 'Applied' }),
    );
    let mine = (await get('/referrals/me', ada.authHeader)).json().ambassador;
    expect(mine).toEqual(
      expect.objectContaining({ joined: true, status: 'applied', approved: false, link: null }),
    );
    // A link used now ties nothing.
    const early = await joinShop({ ambassador: ada.via });
    expect(
      (await harness.repository.partnerShops.findById(early.shop.id))?.ambassadorId,
    ).toBeNull();

    // The documents, read by the automatic check and marked checked.
    await sendEverything(ada.authHeader);
    const application = (await get('/ambassador/application', ada.authHeader)).json().application;
    expect(application).toEqual(
      expect.objectContaining({
        status: 'documents_checked',
        documentsIn: true,
        message: "We'll contact you to have a short chat before you start.",
        stillNeeded: [],
      }),
    );
    expect(application.documents.map((row: { status: string }) => row.status)).toEqual([
      'accepted',
      'accepted',
      'accepted',
    ]);
    // Still not approved by itself.
    expect((await agreementOf(ada.shopperId)).status).toBe('documents_checked');
    expect((await get('/ambassador/toolkit', ada.authHeader)).statusCode).toBe(403);

    // Approve is refused before the chat.
    const id = (await agreementOf(ada.shopperId)).id;
    const tooSoon = await post(
      `/staff/ambassador-applications/${id}/approve`,
      { by: 'Anthony' },
      STAFF,
    );
    expect(tooSoon.statusCode).toBe(409);
    expect(tooSoon.json().error.message).toBe('Please record the chat with the founder first.');

    const chat = await post(
      `/staff/ambassador-applications/${id}/chat-done`,
      { by: 'Anthony', notes: 'Knows lots of cafés in Chatham.' },
      STAFF,
    );
    expect(chat.statusCode, chat.body).toBe(200);
    expect(await agreementOf(ada.shopperId)).toEqual(
      expect.objectContaining({
        status: 'chat_done',
        chatNotes: 'Knows lots of cafés in Chatham.',
      }),
    );

    const approved = await post(
      `/staff/ambassador-applications/${id}/approve`,
      { by: 'Anthony' },
      STAFF,
    );
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().message).toMatch(/^Ada Obi is approved as an Ozi Ambassador, by /);

    mine = (await get('/referrals/me', ada.authHeader)).json().ambassador;
    expect(mine).toEqual(expect.objectContaining({ status: 'approved', approved: true }));
    expect(mine.link).toMatch(/\/business\/join\?ambassador=shopper-/);
    const tied = await joinShop({ ambassador: ada.via });
    expect((await harness.repository.partnerShops.findById(tied.shop.id))?.ambassadorId).toBe(
      ada.shopperId,
    );
    expect((await get('/ambassador/toolkit', ada.authHeader)).statusCode).toBe(200);
  });

  it('reads the photo ID and proof of address as Runner documents are read, and sends unclear ones to the owner', async () => {
    const brain = standInBrain((input) =>
      input.kind === 'ambassador_proof_of_address'
        ? { ...clearReading(input), issuedOn: '2026-06-01' }
        : input.kind === 'ambassador_driving_licence'
          ? { ...clearReading(input), nameOnDocument: 'SMITH, JOHN' }
          : clearReading(input),
    );
    await build({ brain });
    const ada = await applicant();
    await agree(ada.authHeader);

    const front = await sendDocument(ada.authHeader, {
      kind: 'photo_id_front',
      idType: 'driving_licence',
      image: PHOTO,
      contentType: 'image/jpeg',
    });
    expect(front.statusCode, front.body).toBe(201);
    // A card: its back is needed too.
    expect(front.json().application.stillNeeded.map((row: { kind: string }) => row.kind)).toEqual([
      'photo_id_back',
      'proof_of_address',
      'face_photo',
    ]);
    expect(brain.asked.at(-1)).toEqual(
      expect.objectContaining({ kind: 'ambassador_driving_licence', accountName: 'Ada Obi' }),
    );
    const address = await sendDocument(ada.authHeader, {
      kind: 'proof_of_address',
      addressType: 'utility_bill',
      image: PDF,
      contentType: 'application/pdf',
    });
    expect(address.statusCode, address.body).toBe(201);
    expect(brain.asked.at(-1)?.photo.mediaType).toBe('application/pdf');

    const documents = await harness.repository.ambassadorDocuments.listForAgreement(
      (await agreementOf(ada.shopperId)).id,
    );
    const licence = documents.find((row) => row.kind === 'photo_id_front')!;
    const letter = documents.find((row) => row.kind === 'proof_of_address')!;
    expect(licence).toEqual(
      expect.objectContaining({
        status: 'submitted',
        checkPassed: false,
        checkNote: 'The name on it does not match the name on the account.',
      }),
    );
    expect(letter).toEqual(
      expect.objectContaining({
        status: 'submitted',
        checkPassed: false,
        checkNote: 'It is not dated within the last 3 months.',
        checkIssuedOn: '2026-06-01',
      }),
    );
    const matters = await harness.repository.ownerDesk.findMattersFor(
      'ambassador_document',
      letter.id,
    );
    expect(matters[0]?.summary).toBe(
      "Ambassador applicant Ada Obi's proof of address needs you. It is not dated within the last 3 months.",
    );

    // Staff turn it down with a reason the applicant sees, and it is needed again.
    const rejected = await post(
      `/staff/ambassador-documents/${letter.id}/review`,
      { decision: 'reject', by: 'Anthony', note: 'Please send a letter from the last 3 months.' },
      STAFF,
    );
    expect(rejected.statusCode, rejected.body).toBe(200);
    const application = (await get('/ambassador/application', ada.authHeader)).json().application;
    expect(application.stillNeeded.map((row: { kind: string }) => row.kind)).toContain(
      'proof_of_address',
    );
    expect(
      application.documents.find((row: { kind: string }) => row.kind === 'proof_of_address')
        .reviewNote,
    ).toBe('Please send a letter from the last 3 months.');
    // Settled on the desk: Ozi does not ring about it any more.
    expect(
      (await harness.repository.ownerDesk.findMattersFor('ambassador_document', letter.id))[0]
        ?.status,
    ).toBe('handled');
  });

  it('refuses what is not a photo or a PDF, and a face that is a PDF', async () => {
    await build();
    const ada = await applicant();
    await agree(ada.authHeader);
    const text = await sendDocument(ada.authHeader, {
      kind: 'proof_of_address',
      addressType: 'bank_letter',
      image: PHOTO,
      contentType: 'text/plain',
    });
    expect(text.statusCode).toBe(400);
    const face = await sendDocument(ada.authHeader, {
      kind: 'face_photo',
      image: PDF,
      contentType: 'application/pdf',
    });
    expect(face.json().error.message).toBe('Please send a photo.');
    const fake = await sendDocument(ada.authHeader, {
      kind: 'proof_of_address',
      addressType: 'bank_letter',
      image: PHOTO,
      contentType: 'application/pdf',
    });
    expect(fake.json().error.message).toBe('That file is not a PDF. Please choose another.');
    // Without agreeing first, nothing is taken.
    const bea = await applicant('Bea', '+447700900501');
    expect(
      (
        await sendDocument(bea.authHeader, {
          kind: 'face_photo',
          image: PHOTO,
          contentType: 'image/jpeg',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('tells the owner once the documents are in, and sends a share code to a person', async () => {
    // No language model: everything goes to a person, and nothing is checked by itself.
    await build();
    const ada = await applicant();
    await agree(ada.authHeader);
    await sendEverything(ada.authHeader);
    const code = await sendDocument(ada.authHeader, {
      kind: 'share_code',
      shareCode: 'W12 345 678',
    });
    expect(code.statusCode, code.body).toBe(201);
    const agreement = await agreementOf(ada.shopperId);
    expect(agreement.status).toBe('documents_sent');
    const told = await harness.repository.ownerDesk.findMattersFor(
      'ambassador_application',
      agreement.id,
    );
    expect(told).toHaveLength(1);
    expect(told[0]).toEqual(
      expect.objectContaining({
        summary: 'Ada Obi has applied to be an Ozi Ambassador; documents are ready.',
        options: 'acknowledge',
      }),
    );
    const shareCode = (
      await harness.repository.ambassadorDocuments.listForAgreement(agreement.id)
    ).find((row) => row.kind === 'share_code')!;
    expect(shareCode.shareCode).toBe('W12345678');
    expect(shareCode.checkNote).toMatch(/share code, which the automatic check cannot verify/);
  });
});

describe('the staff Ambassadors page', () => {
  it('is for the founder and the operations manager only', async () => {
    await build();
    const ada = await applicant();
    await agree(ada.authHeader);
    expect((await get('/staff/ambassador-applications')).statusCode).toBe(403);
    expect(
      (await get('/staff/ambassador-applications', await staffToken('customer_care', 'kemi')))
        .statusCode,
    ).toBe(403);
    expect(
      (await get('/staff/ambassador-applications', await staffToken('partnerships', 'sade')))
        .statusCode,
    ).toBe(403);
    const manager = await get(
      '/staff/ambassador-applications',
      await staffToken('operations_manager', 'tolu'),
    );
    expect(manager.statusCode, manager.body).toBe(200);
    const groups = manager.json().groups as Array<{
      status: string;
      words: string;
      applications: Array<{ name: string }>;
    }>;
    expect(groups.map((group) => group.words)).toEqual([
      'Applied',
      'Documents sent',
      'Documents checked',
      'Chat done',
      'Approved',
      'Declined',
      'Suspended',
      'Documents needed',
      'Removed for fraud',
    ]);
    expect(groups[0]!.applications.map((row) => row.name)).toEqual(['Ada Obi']);
    // A Shopper cannot open it either.
    expect((await get('/staff/ambassador-applications', ada.authHeader)).statusCode).toBe(403);
  });

  it('opens an application with its documents and files, declines with a reason they see, and suspends', async () => {
    await build({ brain: standInBrain() });
    const ada = await applicant();
    await agree(ada.authHeader);
    await sendEverything(ada.authHeader);
    const id = (await agreementOf(ada.shopperId)).id;
    const detail = (await get(`/staff/ambassador-applications/${id}`, STAFF)).json().application;
    expect(detail).toEqual(
      expect.objectContaining({
        name: 'Ada Obi',
        status: 'documents_checked',
        canRecordChat: true,
        canApprove: false,
      }),
    );
    const pdf = detail.documents.find((row: { sentAs: string }) => row.sentAs === 'PDF');
    expect(pdf).toEqual(
      expect.objectContaining({ checkPassed: true, checkIssuedOn: '2026-10-01', hasFile: true }),
    );
    const file = await get(`/staff/ambassador-documents/${pdf.id}/file`, STAFF);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['cache-control']).toBe('no-store');
    expect(
      (await get(`/staff/ambassador-documents/${pdf.id}/file`, ada.authHeader)).statusCode,
    ).toBe(403);

    expect(
      (await post(`/staff/ambassador-applications/${id}/decline`, { by: 'Anthony' }, STAFF))
        .statusCode,
    ).toBe(400);
    const declined = await post(
      `/staff/ambassador-applications/${id}/decline`,
      { by: 'Anthony', reason: 'We are not taking Ambassadors in your area yet.' },
      STAFF,
    );
    expect(declined.statusCode, declined.body).toBe(200);
    const application = (await get('/ambassador/application', ada.authHeader)).json().application;
    expect(application).toEqual(
      expect.objectContaining({
        status: 'declined',
        reason: 'We are not taking Ambassadors in your area yet.',
        message:
          'Your application was not approved. We are not taking Ambassadors in your area yet. You can apply again from 10 May 2027.',
      }),
    );
    expect((await agreementOf(ada.shopperId)).stoppedAt).toEqual(harness.now());
  });

  it('suspends an approved Ambassador: the link, the Toolkit and withdrawals stop', async () => {
    await build();
    const ada = await approvedAmbassador();
    const id = (await agreementOf(ada.shopperId)).id;
    const suspended = await post(
      `/staff/ambassador-applications/${id}/suspend`,
      { by: 'Anthony', reason: 'A complaint is being looked into.' },
      STAFF,
    );
    expect(suspended.statusCode, suspended.body).toBe(200);
    expect((await get('/referrals/me', ada.authHeader)).json().ambassador.link).toBeNull();
    expect((await get('/ambassador/toolkit', ada.authHeader)).statusCode).toBe(403);
    const shop = await joinShop({ ambassador: ada.via });
    expect((await harness.repository.partnerShops.findById(shop.shop.id))?.ambassadorId).toBeNull();
    const withdraw = await post('/ambassador/withdraw', {}, ada.authHeader);
    expect(withdraw.json().error.message).toMatch(/suspended/);
    // Approved again: they had their chat before, so the founder may lift it.
    const again = await post(
      `/staff/ambassador-applications/${id}/approve`,
      { by: 'Anthony' },
      STAFF,
    );
    expect(again.statusCode, again.body).toBe(200);
    expect((await get('/ambassador/toolkit', ada.authHeader)).statusCode).toBe(200);
  });
});

describe('Ambassadors who opted in before applications', () => {
  it('keep their link and earnings as "documents needed"; the Toolkit and withdrawals wait for approval', async () => {
    await build({ brain: standInBrain() });
    const ada = await applicant();
    // As the migration leaves everyone who agreed before.
    await harness.repository.ambassadors.agree({
      accountKind: 'shopper',
      accountId: ada.shopperId,
      agreedAt: new Date('2026-10-30T12:00:00.000Z'),
      termsVersion: AMBASSADOR_TERMS_VERSION,
      status: 'documents_needed',
    });
    const mine = (await get('/referrals/me', ada.authHeader)).json().ambassador;
    expect(mine).toEqual(
      expect.objectContaining({
        status: 'documents_needed',
        statusWords: 'Documents needed',
        approved: false,
      }),
    );
    expect(mine.applicationMessage).toMatch(
      /Your Ambassador link keeps working and your earnings keep adding up/,
    );
    expect(mine.link).toMatch(/\/business\/join\?ambassador=shopper-/);
    const shop = await joinShop({ ambassador: ada.via });
    expect((await harness.repository.partnerShops.findById(shop.shop.id))?.ambassadorId).toBe(
      ada.shopperId,
    );

    const toolkit = await get('/ambassador/toolkit', ada.authHeader);
    expect(toolkit.statusCode).toBe(403);
    expect(toolkit.json().error.message).toBe(
      'The Ambassador Toolkit opens once your documents are checked and you have had a short chat with us.',
    );
    await harness.repository.ambassadors.add({
      ambassadorKind: 'shopper',
      ambassadorId: ada.shopperId,
      kind: 'share',
      partnerShopId: shop.shop.id,
      orderId: null,
      profitPence: 0,
      amountPence: 1500,
      availableAt: new Date('2026-11-01T10:00:00.000Z'),
      reference: 'share:old',
      recordedBy: null,
      at: harness.now(),
    });
    const withdraw = await post('/ambassador/withdraw', {}, ada.authHeader);
    expect(withdraw.statusCode).toBe(409);
    expect(withdraw.json().error.message).toMatch(
      /please send your documents and have a short chat/,
    );
    expect((await get('/referrals/me', ada.authHeader)).json().ambassador.canWithdraw).toBe(false);
    // Staff cannot mark them paid either, until approved.
    expect(
      (await post(`/staff/ambassadors/shopper/${ada.shopperId}/paid`, { by: 'Anthony' }, STAFF))
        .statusCode,
    ).toBe(409);

    // Sending their documents never stops the link on the way.
    await sendEverything(ada.authHeader);
    const agreement = await agreementOf(ada.shopperId);
    expect(agreement.status).toBe('documents_needed');
    expect(agreement.documentsCheckedAt).toEqual(harness.now());
    expect((await get('/referrals/me', ada.authHeader)).json().ambassador.link).toBeTruthy();
    await post(
      `/staff/ambassador-applications/${agreement.id}/chat-done`,
      { by: 'Anthony' },
      STAFF,
    );
    const approved = await post(
      `/staff/ambassador-applications/${agreement.id}/approve`,
      { by: 'Anthony' },
      STAFF,
    );
    expect(approved.statusCode, approved.body).toBe(200);
    expect((await get('/ambassador/toolkit', ada.authHeader)).statusCode).toBe(200);
    expect((await get('/referrals/me', ada.authHeader)).json().ambassador.canWithdraw).toBe(true);
  });
});

describe('the Ambassador Toolkit', () => {
  it('gives an approved Ambassador their own links and first name, and their businesses', async () => {
    await build();
    const ada = await approvedAmbassador();
    const shop = await joinShop({ ambassador: ada.via });
    const toolkit = (await get('/ambassador/toolkit', ada.authHeader)).json();
    expect(toolkit).toEqual(
      expect.objectContaining({
        firstName: 'Ada',
        businessLink: expect.stringMatching(
          new RegExp(`/business/join\\?ambassador=shopper-${ada.handle}$`),
        ),
        shopperLink: expect.stringMatching(new RegExp(`/join\\?via=shopper-${ada.handle}$`)),
        runnerLink: expect.stringMatching(
          new RegExp(`/runner/sign-up\\?via=shopper-${ada.handle}$`),
        ),
      }),
    );
    // Waiting for approval: no counter card yet (31 October 2026).
    expect(toolkit.businesses).toEqual([
      expect.objectContaining({
        id: shop.shop.id,
        statusWords: 'Waiting for approval',
        cardsAllowed: false,
        shopLink: null,
      }),
    ]);
  });
});

describe('Sign up this business now', () => {
  const business = {
    name: 'Mama Put Kitchen',
    kind: 'food',
    address: '3 Canterbury Street, Gillingham',
    postcode: 'ME7 5TP',
    hours: 'Every day 11am to 10pm',
    contactName: 'Chika Eze',
    mobile: '07700 900 888',
    email: 'chika@example.com',
    username: 'mamaput',
    password: 'a-long-enough-password',
    termsAgreed: true,
    ownerAgrees: true,
    ownerName: 'Chika Eze',
    agreedMarkupPercent: 30,
    agreedDiscountPercent: 20,
  };

  it('makes a pending application tied to the Ambassador, with the owner’s agreement and the proposed mark-up and discount', async () => {
    await build();
    const ada = await approvedAmbassador();
    // The owner must agree, in their own name.
    const unsigned = await post(
      '/ambassador/businesses',
      { ...business, ownerAgrees: false },
      ada.authHeader,
    );
    expect(unsigned.statusCode).toBe(400);
    expect(unsigned.body).toMatch(/I am the owner or manager|owner or manager and you agree/);
    const noTerms = await post(
      '/ambassador/businesses',
      { ...business, termsAgreed: false },
      ada.authHeader,
    );
    expect(noTerms.statusCode).toBe(400);
    // Within the caps.
    const tooMuch = await post(
      '/ambassador/businesses',
      { ...business, agreedMarkupPercent: 500 },
      ada.authHeader,
    );
    expect(tooMuch.statusCode).toBe(400);

    const made = await post('/ambassador/businesses', business, ada.authHeader);
    expect(made.statusCode, made.body).toBe(201);
    const body = made.json();
    expect(body.token).toBeUndefined();
    expect(body.reference).toMatch(/^OZA-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const shop = (await harness.repository.partnerShops.findById(body.shop.id))!;
    expect(shop).toEqual(
      expect.objectContaining({
        status: 'pending',
        ambassadorKind: 'shopper',
        ambassadorId: ada.shopperId,
        agreementReference: body.reference,
        proposedMarkupPercent: 30,
        proposedDiscountPercent: 20,
        agreedMarkupPercent: 0,
        agreedDiscountPercent: 0,
        ownerAgreedName: 'Chika Eze',
        termsVersion: expect.any(String),
      }),
    );
    // The owner can sign in with the sign-in they chose.
    const owner = await post('/business/sign-in', {
      username: 'mamaput',
      password: 'a-long-enough-password',
    });
    expect(owner.statusCode, owner.body).toBe(200);
    // A referral too, as an Ambassador's link is.
    expect((await harness.repository.referrals.findFor('partner', shop.id))?.referrerId).toBe(
      ada.shopperId,
    );
    // The owner is told on the desk, with the reference.
    const matter = (await harness.repository.ownerDesk.findMattersFor('partner_shop', shop.id))[0];
    expect(matter?.summary).toContain(
      `signed up by Ozi Ambassador Ada Obi, agreement ${body.reference}`,
    );

    // The sheet's details, for the Ambassador who signed it up only.
    const sheet = await get(`/ambassador/agreements/${body.reference}`, ada.authHeader);
    expect(sheet.statusCode, sheet.body).toBe(200);
    expect(sheet.json()).toEqual(
      expect.objectContaining({
        business: 'Mama Put Kitchen',
        markupPercent: 30,
        discountPercent: 20,
        ownerName: 'Chika Eze',
        ambassadorName: 'Ada Obi',
        checkLink: expect.stringMatching(new RegExp(`/business/agreement/${body.reference}$`)),
      }),
    );
    const bea = await applicant('Bea', '+447700900501');
    expect((await get(`/ambassador/agreements/${body.reference}`, bea.authHeader)).statusCode).toBe(
      403,
    );
  });

  it('refuses an owner whose phone or email is the Ambassador’s own', async () => {
    await build();
    const ada = await approvedAmbassador();
    const own = await post(
      '/ambassador/businesses',
      { ...business, mobile: '07700 900500' },
      ada.authHeader,
    );
    expect(own.statusCode).toBe(409);
    expect(own.json().error.message).toMatch(/An Ambassador cannot introduce their own business/);
    expect(
      (await harness.repository.partnerShops.list()).filter((row) => row.name === business.name),
    ).toEqual([]);
  });

  it('is for approved Ambassadors only', async () => {
    await build();
    const ada = await applicant();
    await agree(ada.authHeader);
    expect((await post('/ambassador/businesses', business, ada.authHeader)).statusCode).toBe(403);
  });

  it('is approved by staff only with the sheet’s reference, which confirms the mark-up and discount', async () => {
    await build();
    const ada = await approvedAmbassador();
    const { shop, reference } = (
      await post('/ambassador/businesses', business, ada.authHeader)
    ).json();

    // A forged or copied sheet: the public check says so, and nothing is approved without it.
    const forged = (await get('/partner-agreements/OZA-AAAA-BBBB')).json();
    expect(forged).toEqual({ found: false, reference: 'OZA-AAAA-BBBB' });
    const real = (await get(`/partner-agreements/${reference.toLowerCase()}`)).json();
    expect(real).toEqual(
      expect.objectContaining({ found: true, business: 'Mama Put Kitchen', status: 'pending' }),
    );
    expect(JSON.stringify(real)).not.toContain('07700');

    const without = await post(`/staff/partners/${shop.id}`, { status: 'approved' }, STAFF);
    expect(without.statusCode).toBe(400);
    const wrong = await post(
      `/staff/partners/${shop.id}`,
      { status: 'approved', agreementReference: 'OZA-AAAA-BBBB' },
      STAFF,
    );
    expect(wrong.statusCode).toBe(409);
    expect(wrong.json().error.message).toBe(
      'That reference does not match the agreement for this business. Nothing was approved.',
    );
    expect((await harness.repository.partnerShops.findById(shop.id))?.status).toBe('pending');

    // Ozi's desk cannot approve it by the keypad: it needs the reference.
    const matter = (await harness.repository.ownerDesk.findMattersFor('partner_shop', shop.id))[0]!;
    const desk = await post(`/staff/desk/${matter.id}`, { choice: 'approve' }, STAFF);
    expect(desk.statusCode, desk.body).toBe(200);
    expect(desk.json().message).toMatch(/with the reference on its agreement sheet/);
    expect(desk.json().matter.status).toBe('open');
    expect((await harness.repository.partnerShops.findById(shop.id))?.status).toBe('pending');

    const approved = await post(
      `/staff/partners/${shop.id}`,
      { status: 'approved', agreementReference: reference },
      STAFF,
    );
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().shop).toEqual(
      expect.objectContaining({
        status: 'approved',
        agreedMarkupPercent: 30,
        agreedDiscountPercent: 20,
      }),
    );
  });
});

describe('"Did someone introduce you? Their code (optional)" at sign-up', () => {
  it('records the referral by the code typed, for a Shopper, a Runner and a partner, never their own', async () => {
    await build();
    const ada = await applicant();
    const shopper = await post('/shoppers', {
      displayName: 'Bea',
      phone: '+447700900601',
      introducedBy: ada.handle,
    });
    expect(shopper.statusCode, shopper.body).toBe(201);
    expect(
      (await harness.repository.referrals.findFor('shopper', shopper.json().shopper.id))
        ?.referrerId,
    ).toBe(ada.shopperId);
    const runner = await post('/runners', {
      name: 'Dan',
      phone: '+447700900602',
      vehicleType: 'car',
      adult: true,
      homePostcode: 'ME7 1AA',
      introducedBy: `shopper-${ada.handle}`,
    });
    expect(runner.statusCode, runner.body).toBe(201);
    const runnerId = runner.json().runner.id as string;
    expect((await harness.repository.referrals.findFor('runner', runnerId))?.referrerId).toBe(
      ada.shopperId,
    );
    // A Runner ID works too, typed in small letters.
    const code = runner.json().runner.referralCode as string;
    const shop = await joinShop({ introducedBy: code.toLowerCase() });
    expect((await harness.repository.referrals.findFor('partner', shop.shop.id))?.referrerId).toBe(
      runnerId,
    );

    // Their own code: nothing is recorded.
    const self = await post('/runners', {
      name: 'Ada',
      phone: '+447700900500',
      vehicleType: 'car',
      adult: true,
      homePostcode: 'ME7 1AA',
      introducedBy: ada.handle,
    });
    expect(self.statusCode, self.body).toBe(201);
    expect(await harness.repository.referrals.findFor('runner', self.json().runner.id)).toBeNull();
    // A code that is nobody's: the sign-up still works, with nothing recorded.
    const nobody = await post('/shoppers', {
      displayName: 'Cy',
      phone: '+447700900603',
      introducedBy: 'not-a-code',
    });
    expect(nobody.statusCode).toBe(201);
    expect(
      await harness.repository.referrals.findFor('shopper', nobody.json().shopper.id),
    ).toBeNull();
  });

  it('ties an approved Ambassador when a business types their code', async () => {
    await build();
    const ada = await approvedAmbassador();
    const shop = await joinShop({ introducedBy: ada.handle });
    expect((await harness.repository.partnerShops.findById(shop.shop.id))?.ambassadorId).toBe(
      ada.shopperId,
    );
    expect(shop.message).toMatch(/introduced by Ada Obi, an Ozi Ambassador/);
  });
});

describe('how long Ambassador documents are kept (31 October 2026)', () => {
  it('removes a declined applicant’s ID, address and face photo 30 days after, and the note after 12 months', async () => {
    await build({ brain: standInBrain() });
    const ada = await applicant();
    await agree(ada.authHeader);
    await sendEverything(ada.authHeader);
    const id = (await agreementOf(ada.shopperId)).id;
    await post(
      `/staff/ambassador-applications/${id}/chat-done`,
      { by: 'Anthony', notes: 'Did not seem right.' },
      STAFF,
    );
    const declined = await post(
      `/staff/ambassador-applications/${id}/decline`,
      { by: 'Anthony', reason: 'Not now.', dateOfBirth: '1990-04-02' },
      STAFF,
    );
    expect(declined.statusCode, declined.body).toBe(200);
    // Only the short note is kept: name, the name on the ID, the date of birth, date and reason.
    const [note] = await harness.repository.ambassadorNotes.list();
    expect(note).toEqual(
      expect.objectContaining({
        kind: 'declined',
        name: 'Ada Obi',
        nameOnId: 'OBI, ADA NGOZI',
        dateOfBirth: '1990-04-02',
        reason: 'Not now.',
        at: START,
        deleteAfter: new Date('2027-11-10T10:00:00.000Z'),
      }),
    );

    harness.setNow(new Date('2026-12-09T10:00:00.000Z'));
    expect((await sweepAmbassadorRetention(harness.app.ctx)).documentsRemoved).toBe(0);
    let documents = await harness.repository.ambassadorDocuments.listForAgreement(id);
    expect(documents.every((row) => row.image !== null)).toBe(true);

    harness.setNow(new Date('2026-12-10T10:00:00.000Z'));
    expect((await sweepAmbassadorRetention(harness.app.ctx)).documentsRemoved).toBe(3);
    documents = await harness.repository.ambassadorDocuments.listForAgreement(id);
    expect(documents.every((row) => row.image === null && row.erasedAt !== null)).toBe(true);
    // That they were sent, and how they were decided, stays; the chat notes go.
    expect(documents.map((row) => row.status)).toEqual(['accepted', 'accepted', 'accepted']);
    expect(await agreementOf(ada.shopperId)).toEqual(
      expect.objectContaining({ chatNotes: '', decisionReason: 'Not now.' }),
    );
    // Running it again removes nothing more.
    expect(await sweepAmbassadorRetention(harness.app.ctx)).toEqual({
      documentsRemoved: 0,
      notesRemoved: 0,
      reasonsCleared: 0,
    });

    harness.setNow(new Date('2027-11-09T10:00:00.000Z'));
    expect((await sweepAmbassadorRetention(harness.app.ctx)).notesRemoved).toBe(0);
    harness.setNow(new Date('2027-11-10T10:00:00.000Z'));
    expect(await sweepAmbassadorRetention(harness.app.ctx)).toEqual({
      documentsRemoved: 0,
      notesRemoved: 1,
      reasonsCleared: 1,
    });
    expect(await harness.repository.ambassadorNotes.list()).toEqual([]);
    expect((await agreementOf(ada.shopperId)).decisionReason).toBeNull();
    expect(await sweepAmbassadorRetention(harness.app.ctx)).toEqual({
      documentsRemoved: 0,
      notesRemoved: 0,
      reasonsCleared: 0,
    });
  });

  it('keeps an approved Ambassador’s while active, removes a removed one’s 12 months after, keeps the fraud bar, and removes them with the account', async () => {
    await build({ brain: standInBrain() });
    const ada = await applicant();
    await agree(ada.authHeader);
    await sendEverything(ada.authHeader);
    const agreement = await agreementOf(ada.shopperId);
    await harness.repository.ambassadors.updateAgreement(agreement.id, {
      status: 'approved',
      approvedAt: harness.now(),
    });
    harness.setNow(new Date('2029-01-01T10:00:00.000Z'));
    expect((await sweepAmbassadorRetention(harness.app.ctx)).documentsRemoved).toBe(0);

    // Suspended: kept while it is looked into.
    await post(
      `/staff/ambassador-applications/${agreement.id}/suspend`,
      { by: 'Anthony', reason: 'Looking into orders.' },
      STAFF,
    );
    harness.setNow(new Date('2030-06-01T10:00:00.000Z'));
    expect((await sweepAmbassadorRetention(harness.app.ctx)).documentsRemoved).toBe(0);
    const removed = await post(
      `/staff/ambassador-applications/${agreement.id}/remove-for-fraud`,
      { by: 'Anthony', reason: 'Made-up orders.', shops: 'all' },
      STAFF,
    );
    expect(removed.statusCode, removed.body).toBe(200);
    harness.setNow(new Date('2031-05-31T10:00:00.000Z'));
    expect((await sweepAmbassadorRetention(harness.app.ctx)).documentsRemoved).toBe(0);
    harness.setNow(new Date('2031-06-01T10:00:00.000Z'));
    expect((await sweepAmbassadorRetention(harness.app.ctx)).documentsRemoved).toBe(3);
    // The fraud bar stays for ever.
    harness.setNow(new Date('2040-01-01T10:00:00.000Z'));
    expect((await sweepAmbassadorRetention(harness.app.ctx)).notesRemoved).toBe(0);
    expect((await harness.repository.ambassadorNotes.list()).map((note) => note.kind)).toEqual([
      'fraud',
    ]);

    // Removed with the account, at once.
    const bea = await applicant('Bea Obi', '+447700900501');
    await agree(bea.authHeader);
    await sendEverything(bea.authHeader);
    const beaAgreement = await agreementOf(bea.shopperId);
    await harness.repository.retention.eraseShopper(bea.shopperId, harness.now());
    expect(
      (await harness.repository.ambassadorDocuments.listForAgreement(beaAgreement.id)).every(
        (row) => row.image === null,
      ),
    ).toBe(true);
  });
});

describe('declined Ambassadors may apply again after 6 months (31 October 2026)', () => {
  it('refuses an earlier application with the date, then starts a new one with new documents', async () => {
    await build({ brain: standInBrain() });
    const ada = await applicant();
    await agree(ada.authHeader);
    await sendEverything(ada.authHeader);
    const id = (await agreementOf(ada.shopperId)).id;
    const declined = await post(
      `/staff/ambassador-applications/${id}/decline`,
      { by: 'Anthony', reason: 'Not now.' },
      STAFF,
    );
    expect(declined.json().message).toMatch(/may apply again from 10 May 2027/);
    const mine = (await get('/ambassador/application', ada.authHeader)).json().application;
    expect(mine.message).toBe(
      'Your application was not approved. Not now. You can apply again from 10 May 2027.',
    );
    expect(mine.canApplyAgain).toBe(false);

    harness.setNow(new Date('2027-05-09T10:00:00.000Z'));
    const early = await post(
      '/ambassador/join',
      { termsAgreed: true, termsVersion: AMBASSADOR_TERMS_VERSION },
      ada.authHeader,
    );
    expect(early.statusCode).toBe(409);
    expect(early.json().error.message).toBe(
      'Your last application was not approved on 10 November 2026. You can apply again from 10 May 2027.',
    );

    harness.setNow(new Date('2027-05-10T10:00:00.000Z'));
    const again = await agree(ada.authHeader);
    expect(again.application).toEqual(
      expect.objectContaining({ status: 'applied', documentsIn: false, faceConsent: null }),
    );
    expect(again.application.stillNeeded.map((row: { kind: string }) => row.kind)).toEqual([
      'photo_id_front',
      'photo_id_back',
      'proof_of_address',
      'face_photo',
    ]);
    const agreement = await agreementOf(ada.shopperId);
    expect(agreement).toEqual(
      expect.objectContaining({ decisionReason: null, chatDoneAt: null, stoppedAt: null }),
    );
    expect(
      (await harness.repository.ambassadorDocuments.listForAgreement(id)).every(
        (row) => row.image === null,
      ),
    ).toBe(true);
  });

  it('shows staff a note whose name matches a new applicant on another account', async () => {
    await build({ brain: standInBrain() });
    const ada = await applicant();
    await agree(ada.authHeader);
    await sendEverything(ada.authHeader);
    const first = (await agreementOf(ada.shopperId)).id;
    await post(
      `/staff/ambassador-applications/${first}/decline`,
      { by: 'Anthony', reason: 'Documents did not match.' },
      STAFF,
    );
    // The same name on the ID, from another account.
    const other = await applicant('Ada Ngozi Obi', '+447700900509');
    await agree(other.authHeader);
    await sendEverything(other.authHeader);
    const second = (await agreementOf(other.shopperId)).id;
    const detail = (await get(`/staff/ambassador-applications/${second}`, STAFF)).json()
      .application;
    expect(detail.identityMatches).toEqual([
      expect.objectContaining({
        kind: 'declined',
        words: expect.stringMatching(/^Declined on 10 November 2026: Ada Obi/),
      }),
    ]);
  });
});

describe('suspended Ambassadors (31 October 2026)', () => {
  async function withShares() {
    const ada = await approvedAmbassador();
    const honest = await joinShop({ ambassador: ada.via });
    const fraud = await joinShop({ ambassador: ada.via });
    const add = (reference: string, shop: string, amountPence: number, at: string) =>
      harness.repository.ambassadors.add({
        ambassadorKind: 'shopper',
        ambassadorId: ada.shopperId,
        kind: 'share',
        partnerShopId: shop,
        orderId: null,
        profitPence: 0,
        amountPence,
        availableAt: new Date('2026-11-01T10:00:00.000Z'),
        reference,
        recordedBy: null,
        at: new Date(at),
      });
    await add('share:1', honest.shop.id, 1500, '2026-10-01T10:00:00.000Z');
    await add('share:2', fraud.shop.id, 2000, '2026-10-02T10:00:00.000Z');
    await add('share:3', fraud.shop.id, 1000, '2026-10-03T10:00:00.000Z');
    await add('share:4', honest.shop.id, 700, '2026-10-04T10:00:00.000Z');
    // £20 already paid: it covers the oldest share and part of the next.
    await harness.repository.ambassadors.add({
      ambassadorKind: 'shopper',
      ambassadorId: ada.shopperId,
      kind: 'payment',
      partnerShopId: null,
      orderId: null,
      profitPence: 0,
      amountPence: 2000,
      reference: 'payment:1',
      recordedBy: 'Anthony',
      at: new Date('2026-10-20T10:00:00.000Z'),
    });
    const id = (await agreementOf(ada.shopperId)).id;
    return { ada, honest, fraud, id };
  }

  it('holds their earnings while suspended and releases them in full when lifted', async () => {
    await build();
    const { ada, id } = await withShares();
    await post(
      `/staff/ambassador-applications/${id}/suspend`,
      { by: 'Anthony', reason: 'A complaint is being looked into.' },
      STAFF,
    );
    const held = (await get('/referrals/me', ada.authHeader)).json().ambassador;
    expect(held).toEqual(
      expect.objectContaining({ held: true, availablePence: 3200, canWithdraw: false }),
    );
    expect(held.heldWords).toMatch(/released in full if the suspension is lifted/);
    const paid = await post(
      `/staff/ambassadors/shopper/${ada.shopperId}/paid`,
      { by: 'Anthony' },
      STAFF,
    );
    expect(paid.statusCode).toBe(409);
    expect(paid.json().error.message).toMatch(/held/);
    expect((await get(`/staff/ambassador-applications/${id}`, STAFF)).json().application).toEqual(
      expect.objectContaining({ canLift: true, canRemoveForFraud: true }),
    );

    const lifted = await post(
      `/staff/ambassador-applications/${id}/lift`,
      { by: 'Anthony' },
      STAFF,
    );
    expect(lifted.statusCode, lifted.body).toBe(200);
    expect(lifted.json().message).toMatch(
      /suspension is lifted, by .*Everything they earned is released/,
    );
    const after = (await get('/referrals/me', ada.authHeader)).json().ambassador;
    expect(after).toEqual(
      expect.objectContaining({ status: 'approved', held: false, availablePence: 3200 }),
    );
  });

  it('removes for fraud: cancels the unpaid shares from the businesses marked, and bars them for ever', async () => {
    await build();
    const { ada, fraud, id } = await withShares();
    expect(
      (
        await post(
          `/staff/ambassador-applications/${id}/remove-for-fraud`,
          { by: 'Anthony', reason: 'Made-up orders.', shops: [fraud.shop.id] },
          STAFF,
        )
      ).statusCode,
    ).toBe(409);
    await post(
      `/staff/ambassador-applications/${id}/suspend`,
      { by: 'Anthony', reason: 'Orders look made up.' },
      STAFF,
    );
    const detail = (await get(`/staff/ambassador-applications/${id}`, STAFF)).json().application;
    expect(
      detail.businesses
        .map((row: { unpaidPence: number }) => row.unpaidPence)
        .sort((a: number, b: number) => a - b),
    ).toEqual([700, 2500]);
    const removed = await post(
      `/staff/ambassador-applications/${id}/remove-for-fraud`,
      { by: 'Anthony', reason: 'Made-up orders.', shops: [fraud.shop.id] },
      STAFF,
    );
    expect(removed.statusCode, removed.body).toBe(200);
    // Share 2 was £5 paid and £15 unpaid; share 3 £10 unpaid: £25 cancelled.
    expect(removed.json().message).toMatch(/£25\.00 of unpaid shares cancelled/);
    const entries = await harness.repository.ambassadors.listFor('shopper', ada.shopperId);
    expect(
      entries
        .filter((row) => row.kind === 'share')
        .map((row) => [row.reference, row.amountPence, row.cancelledPence]),
    ).toEqual([
      ['share:1', 1500, 0],
      ['share:2', 500, 1500],
      ['share:3', 0, 1000],
      ['share:4', 700, 0],
    ]);
    expect(entries.find((row) => row.reference === 'share:3')?.cancelReason).toBe(
      'Removed for fraud: Made-up orders.',
    );
    // What is left from the honest business may still be paid by hand.
    const mine = (await get('/referrals/me', ada.authHeader)).json().ambassador;
    expect(mine).toEqual(expect.objectContaining({ status: 'removed', availablePence: 700 }));
    // Never again.
    const again = await post(
      '/ambassador/join',
      { termsAgreed: true, termsVersion: AMBASSADOR_TERMS_VERSION },
      ada.authHeader,
    );
    expect(again.statusCode).toBe(409);
    expect(again.json().error.message).toBe(
      'You were removed as an Ozi Ambassador, so we cannot accept a new application from you.',
    );
    harness.setNow(new Date('2035-01-01T10:00:00.000Z'));
    await sweepAmbassadorRetention(harness.app.ctx);
    // Still barred years later, after every sweep (the sign-in has long run out by then).
    await expect(
      becomeAmbassador(harness.app.ctx, 'shopper', ada.shopperId, AMBASSADOR_TERMS_VERSION),
    ).rejects.toThrow(/cannot accept a new application from you/);
  });

  it('cancels every unpaid share when staff choose all', async () => {
    await build();
    const { ada, id } = await withShares();
    await post(
      `/staff/ambassador-applications/${id}/suspend`,
      { by: 'Anthony', reason: 'Orders look made up.' },
      STAFF,
    );
    const removed = await post(
      `/staff/ambassador-applications/${id}/remove-for-fraud`,
      { by: 'Anthony', reason: 'Made-up orders.', shops: 'all' },
      STAFF,
    );
    expect(removed.json().message).toMatch(/£32\.00 of unpaid shares cancelled/);
    expect((await get('/referrals/me', ada.authHeader)).json().ambassador.availablePence).toBe(0);
  });
});

describe('the face compared with the ID only with consent (31 October 2026)', () => {
  it('with a no, nothing reads the face: a person checks it, and nobody is declined', async () => {
    const brain = standInBrain();
    await build({ brain });
    const ada = await applicant();
    await agree(ada.authHeader);
    await sendEverything(ada.authHeader, false);
    const agreement = await agreementOf(ada.shopperId);
    expect(agreement).toEqual(
      expect.objectContaining({
        faceCompareConsent: false,
        faceCompareConsentAt: START,
        status: 'documents_sent',
      }),
    );
    expect(brain.asked.some((input) => input.kind === 'face_photo')).toBe(false);
    const face = (await harness.repository.ambassadorDocuments.listForAgreement(agreement.id)).find(
      (row) => row.kind === 'face_photo',
    )!;
    expect(face).toEqual(
      expect.objectContaining({
        status: 'submitted',
        checkPassed: false,
        checkNote: 'Check by a person: face not compared automatically.',
      }),
    );
    const detail = (await get(`/staff/ambassador-applications/${agreement.id}`, STAFF)).json()
      .application;
    expect(detail.faceCheck).toBe('Check by a person: face not compared automatically');
    // A person accepts it, and the application goes on as any other.
    const accepted = await post(
      `/staff/ambassador-documents/${face.id}/review`,
      { decision: 'accept', by: 'Anthony' },
      STAFF,
    );
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect((await agreementOf(ada.shopperId)).status).toBe('documents_checked');
  });

  it('with a yes, compares the face with the photo on the ID', async () => {
    const brain = standInBrain();
    await build({ brain });
    const ada = await applicant();
    await agree(ada.authHeader);
    await sendEverything(ada.authHeader, true);
    const compared = brain.asked.find((input) => input.kind === 'face_photo');
    expect(compared?.idPhoto).toBeDefined();
    expect((await agreementOf(ada.shopperId)).status).toBe('documents_checked');
  });

  it('asks the question in plain words, and needs a yes or a no', async () => {
    await build();
    const ada = await applicant();
    await agree(ada.authHeader);
    const application = (await get('/ambassador/application', ada.authHeader)).json().application;
    expect(application.faceConsentQuestion).toBe(
      'May we compare your face photo with the photo on your ID? This uses your face, which UK data law treats as sensitive. If you say no, a person will check it instead in your chat with the founder.',
    );
    expect(application.faceConsent).toBeNull();
    const blank = await post('/ambassador/face-consent', {}, ada.authHeader);
    expect(blank.statusCode).toBe(400);
  });
});

describe('counter cards only for businesses that signed the partner agreement (31 October 2026)', () => {
  it('refuses a card for a business that has not, on the API as well as on the screen', async () => {
    await build();
    const ada = await approvedAmbassador();
    const shop = await joinShop({ ambassador: ada.via });
    const waiting = await get(`/ambassador/cards/${shop.shop.id}`, ada.authHeader);
    expect(waiting.statusCode).toBe(403);
    expect(waiting.json().error.message).toBe(
      'Counter cards are printed once the business has signed the partner agreement in the app.',
    );
    await harness.repository.partnerShops.update(shop.shop.id, {
      status: 'approved',
      approvedAt: harness.now(),
    });
    const card = await get(`/ambassador/cards/${shop.shop.id}`, ada.authHeader);
    expect(card.statusCode, card.body).toBe(200);
    expect(card.json().shopLink).toMatch(new RegExp(`/shops/${shop.shop.id}$`));
    const toolkit = (await get('/ambassador/toolkit', ada.authHeader)).json();
    expect(toolkit.businesses[0]).toEqual(expect.objectContaining({ cardsAllowed: true }));

    // Approved but never agreed to the Shop Partner terms in the app (added from a paper form).
    await harness.repository.partnerShops.update(shop.shop.id, {
      termsAgreedAt: null,
      termsVersion: null,
    });
    expect((await get(`/ambassador/cards/${shop.shop.id}`, ada.authHeader)).statusCode).toBe(403);
    expect((await get('/ambassador/toolkit', ada.authHeader)).json().businesses[0]).toEqual(
      expect.objectContaining({ cardsAllowed: false, shopLink: null }),
    );
  });
});
