/**
 * Partner shops are not shop products (ruling 86, Anthony, 31 October 2026). On /staff he asked
 * three times whether he had shop partners to approve, and was told each time about shop
 * products. For the owner, what he says goes to his conversation first; the panel's own answer
 * is only for when that is away, and then it names the right thing. Other staff hear both
 * answered correctly, as the two different things they are.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { setVoiceEngine } from '../src/voice';
import {
  aboutPartnerShops,
  overviewWords,
  ownerAnswersHere,
  partnerShopsWords,
  understand,
} from '../src/voice/staff-voice';
import { fakeEngine, type FakeEngine } from './fake-voice';

/** His exact words, in order. */
const HIS_WORDS = [
  'Do I have any shop partners I need to approve?',
  'shop partner',
  'I do not mean shop products. I am saying shop partner to approve.',
];

const PARTNER_SHOPS_SAID =
  /You have 2 new shop partners waiting for approval: Corner Shop and Bakery\./;

const OVERVIEW = {
  needsYou: [],
  people: {
    shoppers: 1,
    runners: 1,
    runnersOnShiftNow: 0,
    shopPartners: 3,
    organisations: 0,
    staff: 1,
  },
  staffByJob: [],
  work: {
    ordersLastDay: 0,
    ordersLastWeek: 0,
    problemsWaiting: 0,
    documentsWaiting: 0,
    shopProductsWaiting: 0,
    partnerShopsWaiting: 2,
    partnerShopsWaitingNames: ['Corner Shop', 'Bakery'],
    findItWaiting: 0,
  },
};

const PRODUCT = {
  id: 'pp1',
  name: 'Welsh cakes',
  pricePence: 250,
  tags: '',
  expiresOn: null,
  hasPhoto: true,
  status: 'pending',
  note: null,
  catalogueItemId: null,
  createdAt: '2026-10-31T09:00:00.000Z',
  durationMinutes: null,
  shopName: 'Bakery',
};

/** A shop as the Shops and organisations tab lists it. */
function shop(id: string, name: string, status: 'pending' | 'approved'): Record<string, unknown> {
  return {
    id,
    name,
    kind: 'shop',
    kindWords: 'Shop',
    status,
    plan: 'free',
    freeForever: true,
    source: 'self',
    area: 'ME7',
    address: '1 High Street, Gillingham',
    hours: '',
    contactName: 'Bola',
    email: '',
    listed: status === 'approved',
    monthlyPence: 0,
    paidUntil: null,
    paid: false,
    active: true,
    spotlightActive: false,
    live: 0,
    waiting: 0,
    users: [],
    cuisines: [],
    specialities: [],
    categories: [],
    convenience: false,
    ofstedNumber: '',
  };
}

function json(body: unknown, status = 200): Response {
  return {
    ok: status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => Promise.resolve(body),
  } as unknown as Response;
}

function pathOf(url: string): string {
  return String(url)
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/^\/api(?=\/|$)/, '');
}

function spoken(engine: FakeEngine): string {
  return engine.spoken.map((s) => s.text).join(' | ');
}

async function heard(engine: FakeEngine, text: string): Promise<void> {
  await waitFor(() => expect(engine.listening).not.toBeNull());
  engine.hear(text);
}

async function signIn(username: string): Promise<void> {
  const user = userEvent.setup({ delay: null });
  render(
    <MemoryRouter initialEntries={['/staff']}>
      <App />
    </MemoryRouter>,
  );
  await user.type(await screen.findByLabelText('Username'), username);
  await user.type(screen.getByLabelText('Password'), 'a long password');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('the words: partner shops and shop products are different things', () => {
  it('hears each of his phrasings as partner shops, and products as products', () => {
    for (const words of HIS_WORDS) {
      expect(understand(words)).toEqual({ kind: 'partner-shops' });
      expect(aboutPartnerShops(words)).toBe(true);
    }
    for (const words of [
      'partner shops',
      'any new shops?',
      'read me the partners',
      'shop partners',
    ])
      expect(understand(words)).toEqual({ kind: 'partner-shops' });
    for (const words of ['shop products', 'read me the products', 'any products to check?'])
      expect(understand(words)).toEqual({ kind: 'open', area: 'partners' });
    expect(understand("I don't mean shop partners, I mean products")).toEqual({
      kind: 'open',
      area: 'partners',
    });
    // A complaint about a shop is still a decision, not partner shops.
    expect(understand('the shop was at fault')).toEqual(
      expect.objectContaining({ kind: 'decide', decision: 'shop_at_fault' }),
    );
  });

  it('names the right thing aloud', () => {
    expect(partnerShopsWords(2, ['Corner Shop', 'Bakery'])).toMatch(PARTNER_SHOPS_SAID);
    expect(partnerShopsWords(1, ['Bakery'])).toMatch(
      /^You have 1 new shop partner waiting for approval: Bakery\./,
    );
    expect(partnerShopsWords(0, [])).toBe('No new shop partners are waiting for approval.');
    const overview = overviewWords(OVERVIEW);
    expect(overview).toContain('2 new shop partners waiting for approval');
    expect(overview).toContain('0 shop products to check');
  });

  it('for the owner, keeps only explicit moves here; questions go to his conversation', () => {
    const local = (said: string, reading = false): boolean =>
      ownerAnswersHere(understand(said), said, reading);
    expect(local('open the documents tab')).toBe(true);
    expect(local('go to orders')).toBe(true);
    expect(local('sign out')).toBe(true);
    expect(local('read me the complaints')).toBe(true);
    for (const words of HIS_WORDS) expect(local(words)).toBe(false);
    expect(local('how many signups this month')).toBe(false);
    expect(local("what's waiting")).toBe(false);
    expect(local('next')).toBe(false);
    expect(local('next', true)).toBe(true);
    expect(local('accept', true)).toBe(true);
    expect(local('hello Ozi')).toBe(false);
  });
});

describe('the owner on /staff (ruling 86)', () => {
  let asked: Array<{ token: string | null; body: { text: string; mode: string } }>;
  let model: 'answers' | 'down';

  beforeEach(() => {
    asked = [];
    model = 'answers';
    window.sessionStorage.clear();
    window.localStorage.setItem('ozidelivery.voice.settings', JSON.stringify({ introHeard: true }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = pathOf(url);
        if (path === '/staff/sign-in') {
          return json({
            token: 'st1.owner.sig',
            name: 'Anthony',
            role: 'founder',
            title: 'Founder',
            areas: ['team'],
            mustChangePassword: false,
          });
        }
        if (path === '/staff/me') {
          return json({
            name: 'Anthony',
            role: 'founder',
            title: 'Founder',
            // The overview is his, but kept off the screen here: Ozi asks for it by voice.
            areas: ['team', 'overview'],
            account: true,
            mustChangePassword: false,
            isOwner: true,
            address: 'Mr Anthony',
          });
        }
        if (path === '/staff/team') return json({ members: [] });
        if (path === '/staff/overview') return json(OVERVIEW);
        if (path === '/ozi/reply') {
          const headers = new Headers(init?.headers);
          const body = JSON.parse(String(init?.body)) as { text: string; mode: string };
          asked.push({ token: headers.get('x-staff-token'), body });
          if (model === 'down') return json({ error: { message: 'Unavailable.' } }, 503);
          return json({
            reply:
              'Yes, Mr. Anthony. Two new shop partners are waiting for you: Corner Shop and Bakery.',
          });
        }
        return json({});
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends "Do I have any shop partners I need to approve?" to his conversation, not answered here', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    await signIn('anthony');
    await waitFor(() => expect(spoken(engine)).toMatch(/Mr Anthony/));
    await heard(engine, HIS_WORDS[0]!);
    await waitFor(() => {
      expect(engine.spoken.at(-1)?.text).toBe(
        'Yes, Mr. Anthony. Two new shop partners are waiting for you: Corner Shop and Bakery.',
      );
    });
    expect(asked).toEqual([
      {
        token: 'st1.owner.sig',
        body: expect.objectContaining({ text: HIS_WORDS[0], mode: 'within' }),
      },
    ]);
    expect(spoken(engine)).not.toMatch(/shop products/i);
    expect(spoken(engine)).not.toMatch(PARTNER_SHOPS_SAID);
  });

  it('with the conversation away, answers each of his phrasings about partner shops, never products', async () => {
    model = 'down';
    const engine = fakeEngine();
    setVoiceEngine(engine);
    await signIn('anthony');
    await waitFor(() => expect(spoken(engine)).toMatch(/Mr Anthony/));
    for (const [index, words] of HIS_WORDS.entries()) {
      await heard(engine, words);
      await waitFor(() => {
        expect(engine.spoken.filter((s) => PARTNER_SHOPS_SAID.test(s.text))).toHaveLength(
          index + 1,
        );
      });
      expect(engine.spoken.at(-1)?.text).toMatch(/, sir\.$/);
    }
    // Each was offered to his conversation first.
    expect(asked.map((one) => one.body.text)).toEqual(HIS_WORDS);
    expect(spoken(engine)).not.toMatch(/shop products/i);
  });

  it('with the conversation too slow, answers each of his phrasings about partner shops', async () => {
    model = 'answers';
    const engine = fakeEngine();
    setVoiceEngine(engine);
    await signIn('anthony');
    await waitFor(() => expect(spoken(engine)).toMatch(/Mr Anthony/));
    // The conversation never answers: the app stops waiting after about 20 seconds.
    const answering = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) =>
      pathOf(String(url)) === '/ozi/reply'
        ? new Promise<Response>(() => undefined)
        : answering(url as string, init),
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      for (const [index, words] of HIS_WORDS.entries()) {
        await heard(engine, words);
        await vi.advanceTimersByTimeAsync(21_000);
        await waitFor(() => {
          expect(engine.spoken.filter((s) => PARTNER_SHOPS_SAID.test(s.text))).toHaveLength(
            index + 1,
          );
        });
      }
    } finally {
      vi.useRealTimers();
    }
    // He was never left in silence meanwhile.
    expect(engine.spoken.filter((s) => /^One moment, Mr\. Anthony\.$/.test(s.text))).toHaveLength(
      3,
    );
    expect(spoken(engine)).not.toMatch(/shop products/i);
  });
});

describe('the owner, when the conversation is slow (ruling 86)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says "One moment, Mr. Anthony." once after about 3 seconds, then the answer', async () => {
    window.sessionStorage.clear();
    window.localStorage.setItem('ozidelivery.voice.settings', JSON.stringify({ introHeard: true }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = pathOf(url);
        if (path === '/staff/sign-in') {
          return json({
            token: 'st1.owner.sig',
            name: 'Anthony',
            role: 'founder',
            title: 'Founder',
            areas: ['team'],
            mustChangePassword: false,
          });
        }
        if (path === '/staff/me') {
          return json({
            name: 'Anthony',
            role: 'founder',
            title: 'Founder',
            areas: ['team'],
            account: true,
            mustChangePassword: false,
            isOwner: true,
            address: 'Mr Anthony',
          });
        }
        if (path === '/staff/team') return json({ members: [] });
        if (path === '/ozi/reply') {
          await new Promise((resolve) => setTimeout(resolve, 3600));
          return json({ reply: 'No new shop partners are waiting, Mr. Anthony.' });
        }
        return json({});
      }),
    );
    const engine = fakeEngine();
    setVoiceEngine(engine);
    await signIn('anthony');
    await waitFor(() => expect(spoken(engine)).toMatch(/Mr Anthony/));
    await heard(engine, 'How is the business doing today?');
    await waitFor(
      () => {
        expect(engine.spoken.at(-1)?.text).toBe('No new shop partners are waiting, Mr. Anthony.');
      },
      { timeout: 6000 },
    );
    const moments = engine.spoken.filter((s) => /^One moment, Mr\. Anthony\.$/.test(s.text));
    expect(moments).toHaveLength(1);
  }, 10_000);
});

describe('other staff (ruling 86)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hear "shop products" and "shop partners" answered as the different things they are', async () => {
    window.sessionStorage.clear();
    window.localStorage.setItem('ozidelivery.voice.settings', JSON.stringify({ introHeard: true }));
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = pathOf(url);
        asked.push(path);
        const me = {
          name: 'Bola',
          role: 'partnerships',
          title: 'Partnerships officer',
          areas: ['enquiries', 'partners'],
          mustChangePassword: false,
        };
        if (path === '/staff/sign-in') return json({ token: 'st1.bola.sig', ...me });
        if (path === '/staff/me') return json({ ...me, account: true });
        if (path === '/staff/enquiries') return json({ enquiries: [] });
        if (path === '/staff/partner-products') return json({ products: [PRODUCT] });
        if (path === '/staff/partners') {
          return json({
            shops: [
              shop('s1', 'Corner Shop', 'pending'),
              shop('s2', 'Bakery', 'pending'),
              shop('s3', 'Old Shop', 'approved'),
            ],
            organisations: [],
            plusMonthlyPence: 1499,
            freeListingCount: 100,
            freeListed: 3,
            freeProductLimit: 20,
            restaurantWords: '',
            preferredDiscountPercent: 10,
            maximumDiscountPercent: 30,
            maximumMarkupPercent: 20,
            spotlightPence: 500,
            spotlightPlusPence: 1000,
            seedShops: 0,
          });
        }
        if (path.startsWith('/config')) return json({ push: { publicKey: null } });
        return json({ error: { message: `Nothing stubbed for ${path}` } }, 404);
      }),
    );
    const engine = fakeEngine();
    setVoiceEngine(engine);
    await signIn('bola');
    await waitFor(() => expect(spoken(engine)).toMatch(/Bola/));

    await heard(engine, 'shop products');
    await waitFor(() => {
      expect(engine.spoken.at(-1)?.text).toMatch(
        /^Shop product 1 of 1\. Bakery sent Welsh cakes, at £2\.50/,
      );
    });

    await heard(engine, 'shop partners');
    await waitFor(() => {
      expect(engine.spoken.at(-1)?.text).toMatch(PARTNER_SHOPS_SAID);
    });
    expect(engine.spoken.at(-1)?.text).not.toMatch(/product/i);
    // Other staff keep today's way: the panel answers, the conversation is not asked.
    expect(asked).not.toContain('/ozi/reply');
  });
});
