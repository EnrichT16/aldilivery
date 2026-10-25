/**
 * Browsing places by kind (ruling 82): Restaurants, Shops, Convenience stores and Services, each
 * at its own address with the four as tabs; "Country and continental" as a disclosure listing
 * the cuisines from config and filtering by one; the search and the postcode; "Near you" and
 * "Further away"; each place a disclosure; honest empty states; the four large tiles on the
 * Shopper's home page; Ofsted numbers shown as given; and no accessibility violations.
 */

import axe from 'axe-core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { storeConfig } from '../src/config';
import { placeNamed } from '../src/pages/Browse';
import { FAKE_CATALOGUE } from './setup';

interface Place {
  id: string;
  name: string;
  about: string;
  kind: 'shop' | 'food' | 'service';
  kindWords: string;
  area: string;
  hours: string;
  listedByOzi: boolean;
  products: number;
  section: string;
  cuisines: string[];
  specialities: string[];
  categories: string[];
  convenience: boolean;
  ofstedNumber: string;
}

function place(
  partial: Partial<Place> & Pick<Place, 'id' | 'name' | 'kind' | 'area' | 'section'>,
): Place {
  return {
    about: '',
    kindWords:
      partial.kind === 'food' ? 'Café or takeaway' : partial.kind === 'shop' ? 'Shop' : 'Service',
    hours: 'Every day 9am to 9pm',
    listedByOzi: false,
    products: 0,
    cuisines: [],
    specialities: [],
    categories: [],
    convenience: false,
    ofstedNumber: '',
    ...partial,
  };
}

const PLACES: Place[] = [
  place({
    id: 'mama',
    name: 'Mama Joy Kitchen',
    kind: 'food',
    area: 'ME7',
    section: 'restaurants',
    about: 'Jollof rice and suya.',
    cuisines: ['African'],
  }),
  place({
    id: 'bangkok',
    name: 'Bangkok House',
    kind: 'food',
    area: 'DA1',
    section: 'restaurants',
    cuisines: ['Thai'],
  }),
  place({
    id: 'anatolia',
    name: 'Anatolia Market',
    kind: 'shop',
    area: 'ME7',
    section: 'shops',
    specialities: ['Turkish'],
  }),
  place({
    id: 'corner',
    name: 'Corner Stop',
    kind: 'shop',
    area: 'ME8',
    section: 'convenience',
    convenience: true,
  }),
  place({
    id: 'acorns',
    name: 'Little Acorns',
    kind: 'service',
    area: 'ME7',
    section: 'services',
    categories: ['Nanny and childminder'],
    ofstedNumber: 'EY123456',
  }),
];

let sent: string[];

beforeEach(() => {
  sent = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem('ozidelivery.voice.settings', JSON.stringify({ introHeard: true }));
  const reply = (body: unknown, status = 200): Response =>
    ({
      ok: status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => Promise.resolve(body),
    }) as unknown as Response;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      sent.push(path);
      if (path === '/shops' || path.startsWith('/shops?')) {
        // A small stand-in for the API's filters, so the page's wiring is what is tested.
        const query = new URLSearchParams(path.split('?')[1] ?? '');
        const near = (query.get('near') ?? '').toUpperCase().split(' ')[0] ?? '';
        const q = (query.get('q') ?? '').toLowerCase();
        const rows = PLACES.filter(
          (row) => !query.get('section') || row.section === query.get('section'),
        )
          .filter((row) => !query.get('cuisine') || row.cuisines.includes(query.get('cuisine')!))
          .filter(
            (row) =>
              !query.get('speciality') || row.specialities.includes(query.get('speciality')!),
          )
          .filter((row) => !q || `${row.name} ${row.about}`.toLowerCase().includes(q))
          .map((row) => ({ ...row, nearYou: near ? row.area === near : null }))
          .sort((a, b) => Number(b.nearYou === true) - Number(a.nearYou === true));
        return reply({ shops: rows, near: near || null });
      }
      if (path.startsWith('/catalogue/search')) return reply(FAKE_CATALOGUE);
      if (path === '/me') return reply({ error: { message: 'You are not signed in.' } }, 401);
      if (path.startsWith('/config')) return reply({ push: { publicKey: null } });
      if (path === '/orders/current') return reply({ order: null });
      if (path === '/ozi/reply') return reply({ reply: null });
      return reply({ error: { message: `Nothing stubbed for ${path}` } }, 404);
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

describe('the four pages', () => {
  it.each([
    ['/restaurants', 'Restaurants, cafés and takeaways', 'Restaurants', 'Mama Joy Kitchen'],
    ['/shops', 'Shops', 'Shops', 'Anatolia Market'],
    ['/convenience', 'Convenience stores', 'Convenience stores', 'Corner Stop'],
    ['/services', 'Services', 'Services', 'Little Acorns'],
  ])(
    '%s renders with its own heading, its tab marked current, and its places',
    async (path, heading, tab, first) => {
      renderAt(path);
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
      const tabs = screen.getByRole('navigation', { name: 'Places to browse' });
      expect(within(tabs).getByRole('link', { name: tab })).toHaveAttribute('aria-current', 'page');
      expect(within(tabs).getAllByRole('link')).toHaveLength(4);
      expect(await screen.findByRole('button', { name: new RegExp(first) })).toBeInTheDocument();
    },
  );

  it('opens a place as a disclosure, with its details and a link to its page', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/restaurants');
    const button = await screen.findByRole('button', { name: /Mama Joy Kitchen/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Jollof rice and suya.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Mama Joy Kitchen’s page' })).toHaveAttribute(
      'href',
      '/shops/mama',
    );
  });
});

describe('Country and continental', () => {
  it('lists the cuisines from config, and choosing one lists only those restaurants', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/restaurants');
    const toggle = await screen.findByRole('button', { name: 'Country and continental' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('region', { name: 'Cuisines' });
    for (const cuisine of storeConfig.browse.cuisines) {
      expect(within(list).getByRole('button', { name: cuisine })).toBeInTheDocument();
    }
    await user.click(within(list).getByRole('button', { name: 'African' }));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => {
      expect(sent).toContain('/shops?section=restaurants&cuisine=African');
    });
    expect(await screen.findByText('1 African restaurant.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Bangkok House/ })).toBeNull();
  });

  it('lists shop specialities on the Shops page', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/shops');
    await user.click(await screen.findByRole('button', { name: 'Country and continental' }));
    const list = screen.getByRole('region', { name: 'Shop specialities' });
    expect(within(list).getByRole('button', { name: 'Eastern European' })).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'Turkish' }));
    await waitFor(() => {
      expect(sent).toContain('/shops?section=shops&speciality=Turkish');
    });
  });

  it('is honest and encouraging when there are none yet', async () => {
    renderAt('/restaurants?cuisine=Japanese');
    expect(
      await screen.findByText(
        `No Japanese restaurants on ${storeConfig.assistantName} yet. Know one? Tell them to join at ${storeConfig.browse.joinAddress}`,
      ),
    ).toBeInTheDocument();
    expect(storeConfig.browse.joinAddress).toMatch(/\/business$/);
  });
});

describe('search and nearness', () => {
  it('searches, and shows the places near the postcode first under their own headings', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/restaurants');
    await screen.findByRole('button', { name: /Mama Joy Kitchen/ });
    expect(screen.getByRole('heading', { level: 2, name: 'All restaurants' })).toBeInTheDocument();
    await user.type(
      screen.getByLabelText('Your postcode, to see what is near you first'),
      'ME7 1ER',
    );
    await user.click(screen.getByRole('button', { name: 'Search' }));
    const near = await screen.findByRole('region', { name: 'Near you' });
    expect(within(near).getByRole('button', { name: /Mama Joy Kitchen/ })).toBeInTheDocument();
    const further = screen.getByRole('region', { name: 'Further away' });
    expect(within(further).getByRole('button', { name: /Bangkok House/ })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search restaurants'), 'suya');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      expect(sent).toContain('/shops?section=restaurants&q=suya&near=ME7+1ER');
    });
    expect(await screen.findByText(/1 restaurant matching “suya”/)).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Search restaurants'));
    await user.type(screen.getByLabelText('Search restaurants'), 'pizza');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/Nothing on .* matches “pizza”/)).toBeInTheDocument();
  });
});

describe('services', () => {
  it('says plainly that providers are not vetted, and shows an Ofsted number as given', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/services');
    expect(
      await screen.findByText(/does not vet service providers beyond what each listing says/),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Little Acorns/ }));
    expect(
      screen.getByText(/Ofsted registration number, as the provider gave it: EY123456\./),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Kinds of service' })).toBeInTheDocument();
  });
});

describe('the Shopper’s home page', () => {
  it('has four large tiles near the top, each linking to its page', async () => {
    renderAt('/shop');
    const tiles = await screen.findByRole('navigation', { name: 'Browse places' });
    expect(within(tiles).getByRole('link', { name: 'Restaurants' })).toHaveAttribute(
      'href',
      '/restaurants',
    );
    expect(within(tiles).getByRole('link', { name: 'Shops' })).toHaveAttribute('href', '/shops');
    expect(within(tiles).getByRole('link', { name: 'Convenience stores' })).toHaveAttribute(
      'href',
      '/convenience',
    );
    expect(within(tiles).getByRole('link', { name: 'Services' })).toHaveAttribute(
      'href',
      '/services',
    );
  });
});

describe('opening a place by voice', () => {
  it('finds the place named after "open"', () => {
    const rows = PLACES as unknown as Parameters<typeof placeNamed>[1];
    expect(placeNamed('open Mama Joy Kitchen', rows)?.id).toBe('mama');
    expect(placeNamed('Ozi, open corner stop', rows)?.id).toBe('corner');
    expect(placeNamed('open the basket', rows)).toBeNull();
  });
});

describe('accessibility', () => {
  it.each(['/restaurants', '/shops', '/convenience', '/services'])(
    '%s has no violations, with the list open and a place expanded',
    async (path) => {
      const user = userEvent.setup({ delay: null });
      renderAt(`${path}?near=ME7%201ER`);
      const first = await screen.findAllByRole('button', { expanded: false });
      for (const button of first) await user.click(button);
      const results = await axe.run(document.body, {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
        },
      });
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    },
    20_000,
  );
});
