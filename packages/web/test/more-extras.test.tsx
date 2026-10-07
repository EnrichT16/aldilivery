/**
 * Ozi Plus and the family plan, Ozi Finds It, gift cards, the weekly shop, offers and
 * organisation enquiries (7 October 2026): every price asked before it is taken.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { serverDay } from '../src/components/WeeklyReminder';
import { setVoiceEngine } from '../src/voice';
import { fakeEngine, type FakeEngine } from './fake-voice';
import { FAKE_SHOPPER } from './setup';

let sent: Array<{ method: string; path: string; body: unknown }>;
let shopper: Record<string, unknown> | null;
let weekly: Array<Record<string, unknown>>;

const PLUS_OFF = {
  active: false,
  plusUntil: null,
  family: false,
  familyCode: null,
  members: [],
  joinedFamilyOf: null,
  familyMaximum: 4,
  creditPence: 0,
};

beforeEach(() => {
  sent = [];
  shopper = { ...FAKE_SHOPPER, recipePassUntil: null, plusUntil: null, creditPence: 0 };
  weekly = [];
  window.localStorage.setItem('ozidelivery.session.token', 'test-token');
  const reply = (body: unknown, status = 200): Response =>
    ({
      ok: status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => Promise.resolve(body),
    }) as unknown as Response;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      const method = init?.method ?? 'GET';
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      sent.push({ method, path, body });
      if (path === '/me') {
        return shopper
          ? reply({ role: 'shopper', shopper })
          : reply({ error: { message: 'You are not signed in.' } }, 401);
      }
      if (path === '/extras/plus' && method === 'GET') return reply(PLUS_OFF);
      if (path === '/extras/plus' && method === 'POST') {
        return reply({
          ...PLUS_OFF,
          active: true,
          plusUntil: '2099-11-06T10:00:00.000Z',
          family: true,
          familyCode: 'K7M3QX',
          message:
            'Ozi Plus for a family is on until Friday 6 November. £11.99 was taken from your card ending 4242. It does not renew by itself. To add up to 3 more people, give them your family code: K7M3QX.',
        });
      }
      if (path === '/extras/find-it' && method === 'GET') {
        return reply({
          requests: [
            {
              id: 'f1',
              description: 'Welsh cakes',
              feePence: 200,
              status: 'found',
              foundName: 'Welsh cakes, 6 pack',
              foundShop: 'Market Bakery',
              foundPricePence: 250,
              catalogueItemId: 'item-welsh',
              note: null,
              createdAt: '2026-10-07T10:00:00.000Z',
              decidedAt: '2026-10-07T12:00:00.000Z',
            },
          ],
        });
      }
      if (path === '/extras/find-it' && method === 'POST') {
        return reply(
          {
            request: {
              id: 'f2',
              description: (body as { description: string }).description,
              feePence: 200,
              status: 'looking',
              foundName: null,
              foundShop: null,
              foundPricePence: null,
              catalogueItemId: null,
              note: null,
              createdAt: '2026-10-07T13:00:00.000Z',
              decidedAt: null,
            },
            message:
              "Thank you. A person will look for a blue teapot in up to 3 shops, and tell you here what they find and the price. £2.00 was taken from your card ending 4242, and it comes back if it can't be found.",
          },
          201,
        );
      }
      if (path === '/catalogue/item-welsh') {
        return reply({
          found: true,
          item: {
            id: 'item-welsh',
            name: 'Welsh cakes, 6 pack (from Market Bakery)',
            category: 'Found for you',
            estimatedPricePence: 250,
          },
        });
      }
      if (path === '/extras/gift-cards' && method === 'GET') {
        return reply({ amountsPence: [1000, 2000, 3000, 5000], creditPence: 0, bought: [] });
      }
      if (path === '/extras/gift-cards' && method === 'POST') {
        return reply(
          {
            giftCard: {
              code: 'ABCD-EFGH-JKMN',
              amountPence: 2000,
              recipientName: 'Mum',
              message: '',
              used: false,
              createdAt: '2026-10-07T13:00:00.000Z',
            },
            message:
              'Here is your £20.00 gift card. The code is ABCD-EFGH-JKMN. £20.00 was taken from your card ending 4242.',
          },
          201,
        );
      }
      if (path === '/extras/gift-cards/redeem') {
        return reply({
          creditPence: 2000,
          message: '£20.00 has been added. You have £20.00 to spend.',
        });
      }
      if (path === '/sets' && method === 'GET') return reply({ sets: weekly });
      if (path === '/sets' && method === 'POST') {
        const input = body as { dayOfWeek: number };
        return reply(
          {
            set: {
              id: 'set-1',
              name: 'Weekly shop',
              dayOfWeek: input.dayOfWeek,
              active: true,
              items: [
                { catalogueItemId: 'item-milk', name: 'Semi skimmed milk, 2 pints', quantity: 2 },
              ],
            },
          },
          201,
        );
      }
      if (path === '/orders' && method === 'GET') {
        return reply({
          orders: [
            {
              id: 'order-7',
              status: 'completed',
              totalEstimatePence: 1600,
              finalTotalPence: 1600,
              createdAt: '2026-10-03T09:00:00.000Z',
              deliveredAt: '2026-10-03T11:00:00.000Z',
              items: [
                {
                  id: 'i1',
                  name: 'Semi skimmed milk, 2 pints',
                  quantity: 2,
                  catalogueItemId: 'item-milk',
                },
              ],
            },
          ],
        });
      }
      if (path.startsWith('/catalogue/search')) {
        const name = decodeURIComponent(path.split('q=')[1] ?? '');
        return reply({
          items: [{ id: `item-${name}`, name, category: 'Food', estimatedPricePence: 100 }],
          attribution: '',
          source: 'community',
        });
      }
      if (path === '/organisations/enquiries') {
        return reply(
          {
            message:
              'Thank you, Jo. A person from Example Shop will ring you within two working days.',
          },
          201,
        );
      }
      if (path.startsWith('/config')) return reply({ push: { publicKey: null } });
      if (path === '/orders/current') return reply({ order: null });
      return reply({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
    }),
  );
});

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

function posted(path: string) {
  return sent.filter((request) => request.method === 'POST' && request.path === path);
}

describe('Ozi Plus', () => {
  it('asks before taking the price, and says the family code', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/plus');
    expect(await screen.findByText(/Delivery costs the same for everybody/)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Ozi Plus for my family, £11.99' }));
    expect(posted('/extras/plus')).toEqual([]);
    expect(screen.getByText(/£11\.99 will be taken from your saved card now/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes, get the family plan for £11.99' }));
    expect(await screen.findByText(/give them your family code: K7M3QX/)).toBeInTheDocument();
    expect(posted('/extras/plus')[0]?.body).toEqual({ plan: 'family', priceAccepted: true });
    expect(screen.getByRole('heading', { name: 'Your family' })).toBeInTheDocument();
  });
});

describe('Ozi Finds It', () => {
  it('takes the agreed fee for a new search, and a found item goes in the basket', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/find-it?what=a%20blue%20teapot');
    expect(await screen.findByLabelText('Describe it')).toHaveValue('a blue teapot');
    await user.click(screen.getByRole('button', { name: 'Ask for it to be found' }));
    await user.click(screen.getByRole('button', { name: 'Yes, find it for £2.00' }));
    expect(
      await screen.findByText(/A person will look for a blue teapot in up to 3 shops/),
    ).toBeInTheDocument();
    expect(posted('/extras/find-it')[0]?.body).toEqual({
      description: 'a blue teapot',
      priceAccepted: true,
    });

    await user.click(
      screen.getByRole('button', { name: /^Add it to my basket.*Welsh cakes, 6 pack$/ }),
    );
    expect(
      await screen.findByText(/I've put Welsh cakes, 6 pack in your basket/),
    ).toBeInTheDocument();
  });
});

describe('gift cards', () => {
  it('buys one after asking, shows the code, and uses one that was given', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/gift-cards');
    await user.click(await screen.findByRole('button', { name: 'Buy a £20.00 gift card' }));
    await user.click(screen.getByRole('button', { name: 'Yes, buy it for £20.00' }));
    expect(await screen.findByText(/The code is ABCD-EFGH-JKMN/)).toBeInTheDocument();
    expect(posted('/extras/gift-cards')[0]?.body).toEqual(
      expect.objectContaining({ amountPence: 2000, priceAccepted: true }),
    );

    await user.type(screen.getByLabelText('The gift card code'), 'wxyz-2345-6789');
    await user.click(screen.getByRole('button', { name: 'Use this gift card' }));
    expect(await screen.findByText(/You have £20\.00 of gift card money/)).toBeInTheDocument();
  });
});

describe('the weekly shop', () => {
  it('books a day from the last order, and says nothing is sent until you say so', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/weekly-shop');
    await user.click(await screen.findByRole('radio', { name: 'Tuesday' }));
    await user.click(screen.getByRole('button', { name: 'Book my weekly shop' }));
    expect(
      await screen.findByText(
        /Your weekly shop is booked for every Tuesday: Semi skimmed milk, 2 pints\./,
      ),
    ).toBeInTheDocument();
    expect(posted('/sets')[0]?.body).toEqual(
      expect.objectContaining({
        dayOfWeek: 2,
        frequency: 'weekly',
        lines: [{ catalogueItemId: 'item-milk', quantity: 2 }],
      }),
    );
  });

  it('counts the days as the server does', () => {
    expect(serverDay(new Date('2026-10-11T12:00:00'))).toBe(7);
    expect(serverDay(new Date('2026-10-12T12:00:00'))).toBe(1);
  });
});

describe('offers and organisations', () => {
  it('says plainly when there are no offers, and lets a shop ask to work with us', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/offers');
    expect(await screen.findByText(/There are no offers just now/)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Ask to work with us' }));
    expect(
      await screen.findByRole('heading', { name: 'Ask to work with us as a shop' }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('The shop’s name'), 'Corner Shop');
    await user.type(screen.getByLabelText('Your name'), 'Jo');
    await user.type(screen.getByLabelText('A telephone number'), '01634 000000');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/will ring you within two working days/)).toBeInTheDocument();
    expect(posted('/organisations/enquiries')[0]?.body).toEqual(
      expect.objectContaining({ organisation: 'Corner Shop', telephone: '01634 000000' }),
    );
  });

  it('keeps the menu short, with everything else under More', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/shop');
    await user.click(await screen.findByRole('link', { name: 'More' }));
    const list = await screen
      .findByRole('list', { name: '' })
      .catch(() => screen.getByRole('main'));
    expect(within(list).getByRole('link', { name: /Ozi Finds It/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Everyday essentials, today/ })).toHaveAttribute(
      'href',
      '/shop?q=essentials',
    );
  });
});

describe('asking Ozi', () => {
  async function say(engine: FakeEngine, text: string): Promise<void> {
    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    engine.hear(text);
  }
  function voiceReady(): FakeEngine {
    window.localStorage.setItem('ozidelivery.voice.settings', JSON.stringify({ introHeard: true }));
    const engine = fakeEngine();
    setVoiceEngine(engine);
    return engine;
  }

  it('opens each new page when asked', async () => {
    const engine = voiceReady();
    renderAt('/shop');
    await screen.findByRole('link', { name: 'Your order' });
    await say(engine, 'I need a gift card for my sister');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Gift cards' }),
    ).toBeInTheDocument();
    await say(engine, "I can't find it anywhere");
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ozi Finds It' }),
    ).toBeInTheDocument();
    await say(engine, 'tell me about Ozi Plus');
    expect(await screen.findByRole('heading', { level: 1, name: 'Ozi Plus' })).toBeInTheDocument();
    await say(engine, 'are there any offers');
    expect(await screen.findByRole('heading', { level: 1, name: 'Offers' })).toBeInTheDocument();
    await say(engine, 'set up my weekly shop');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your weekly shop' }),
    ).toBeInTheDocument();
  });
});
