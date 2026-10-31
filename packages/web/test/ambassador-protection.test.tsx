/**
 * Protections against Ambassadors misusing the Ozi name on the screen (Anthony, 31 October 2026):
 * the payment warning word for word at the top of both business sign-ups, on the partner
 * dashboard with its three lines, in the Shop Partner terms, on every printed item and in the
 * guide; the public "Check an Ambassador" page; the business confirming with its own code; "Were
 * you promised anything?"; "Report an Ambassador"; the staff "Check this business" links and held
 * shares; and the Ambassador terms. Each new screen is checked with axe.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { AmbassadorGuide } from '../src/components/ambassador/AmbassadorGuide';
import { PartnerProtection } from '../src/components/PartnerProtection';
import { CheckThisBusiness, HeldShares } from '../src/components/StaffAmbassadorChecks';
import { AmbassadorCheck } from '../src/pages/AmbassadorCheck';
import { AmbassadorTerms } from '../src/pages/AmbassadorTerms';
import { PartnerTerms } from '../src/pages/PartnerTerms';
import { BasketProvider } from '../src/state/basket';
import { OziProvider } from '../src/state/ozi';
import { SessionProvider } from '../src/state/session';
import { VoiceProvider } from '../src/state/voice';
import { FAKE_SHOPPER, stubApi, type RecordedRequest } from './setup';

const WORDS =
  'Joining Ozi is always free. We never charge you to join. Paid extras are optional: Spotlight and Partner Plus. You only pay if you choose them. Never pay an Ambassador. All payments are made only inside the app.';

const reply = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => Promise.resolve(body),
  }) as unknown as Response;

/** The usual stand-in API, with these paths answered first. */
function stubWith(
  answer: (method: string, path: string, body: unknown) => Response | null,
  options: Parameters<typeof stubApi>[0] = { shopper: FAKE_SHOPPER },
): RecordedRequest[] {
  const recorded = stubApi(options);
  const base = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      const method = init?.method ?? 'GET';
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      const answered = answer(method, path, body);
      if (answered) {
        recorded.push({ method, path, body });
        return answered;
      }
      return base(url, init);
    }),
  );
  return recorded;
}

/** Only these paths: for a component shown on its own. */
function stubOnly(
  answer: (method: string, path: string, body: unknown) => Response,
): RecordedRequest[] {
  const recorded: RecordedRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      const method = init?.method ?? 'GET';
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      recorded.push({ method, path, body });
      return answer(method, path, body);
    }),
  );
  return recorded;
}

async function noViolations(container: HTMLElement = document.body): Promise<void> {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  } as axe.RunOptions);
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

/** True when `first` comes before `second` in the page. */
function before(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

const TOOLKIT = {
  name: 'Ada Obi',
  firstName: 'Ada',
  businessLink: 'https://example.test/business/join?ambassador=shopper-ada',
  shopperLink: 'https://example.test/join?via=shopper-ada',
  runnerLink: 'https://example.test/runner/sign-up?via=shopper-ada',
  checkCode: 'K7Q2MA',
  checkLink: 'https://example.test/ambassador/check/K7Q2MA',
  printLinks: {
    business:
      'https://example.test/ambassador/check/K7Q2MA?next=%2Fbusiness%2Fjoin%3Fambassador%3Dshopper-ada',
    shopper: 'https://example.test/ambassador/check/K7Q2MA?next=%2Fjoin%3Fvia%3Dshopper-ada',
    runner:
      'https://example.test/ambassador/check/K7Q2MA?next=%2Frunner%2Fsign-up%3Fvia%3Dshopper-ada',
  },
  businesses: [],
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the payment warning, everywhere', () => {
  it('is at the top of the business sign-up, before any field', async () => {
    stubApi();
    const { container } = renderAt('/business/join');
    const heading = await screen.findByRole('heading', { name: 'Joining is free' });
    const notice = heading.closest('section')!;
    expect(notice).toHaveTextContent(WORDS);
    const firstField = container.querySelector('input, select, textarea')!;
    expect(before(notice, firstField)).toBe(true);
  });

  it('is at the top of the Ambassador-led sign-up, before any field', async () => {
    stubWith(() => null);
    const { container } = renderAt('/ambassador/sign-up-business');
    const heading = await screen.findByRole('heading', { name: 'Joining is free' });
    expect(heading.closest('section')).toHaveTextContent(WORDS);
    expect(before(heading, container.querySelector('form input, form select')!)).toBe(true);
  });

  it('is a clause of the Shop Partner terms, and the Ambassador terms forbid money, promises and bank details', () => {
    const terms = render(
      <MemoryRouter>
        <PartnerTerms />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { name: /Joining is free/ }).closest('section'),
    ).toHaveTextContent(WORDS);
    terms.unmount();
    render(
      <MemoryRouter>
        <AmbassadorTerms />
      </MemoryRouter>,
    );
    const rules = screen.getByRole('heading', { name: 'What you must not do' }).closest('section')!;
    expect(rules).toHaveTextContent('Never ask for or take money from anybody, for anything.');
    expect(rules).toHaveTextContent(
      'Never promise anything that is not in the business’s agreement.',
    );
    expect(rules).toHaveTextContent('Never collect anybody’s bank or card details.');
    expect(rules).toHaveTextContent(/Breaking any of the last three is fraud: you are removed/);
  });

  it('is in the Ambassador Guide', () => {
    stubApi();
    render(
      <MemoryRouter>
        <SessionProvider>
          <VoiceProvider>
            <BasketProvider>
              <OziProvider>
                <AmbassadorGuide />
              </OziProvider>
            </BasketProvider>
          </VoiceProvider>
        </SessionProvider>
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { name: /joining is free/ }).closest('section'),
    ).toHaveTextContent(WORDS);
    expect(screen.getByText(/means removal as an Ambassador/)).toBeInTheDocument();
  });

  it('is on every flyer, whose QR code goes through the check page first', async () => {
    stubWith((_method, path) => (path === '/ambassador/toolkit' ? reply(TOOLKIT) : null));
    for (const [flyer, link] of [
      ['business', TOOLKIT.printLinks.business],
      ['shoppers', TOOLKIT.printLinks.shopper],
      ['carers', TOOLKIT.printLinks.shopper],
      ['runners', TOOLKIT.printLinks.runner],
    ] as const) {
      const shown = renderAt(`/ambassador/print/flyer/${flyer}`);
      await screen.findByRole('heading', { level: 1, name: /flyer$/ });
      const area = shown.container.querySelector('.print-area')!;
      expect(area).toHaveTextContent(WORDS);
      expect(area.querySelector('[data-qr-value]')).toHaveAttribute('data-qr-value', link);
      expect(area).toHaveTextContent(/Check code K7Q2MA/);
      shown.unmount();
    }
  });

  it('is on the counter card, whose QR code goes through the check page first', async () => {
    stubWith((_method, path) =>
      path === '/ambassador/toolkit'
        ? reply(TOOLKIT)
        : path === '/ambassador/cards/shop1'
          ? reply({
              id: 'shop1',
              name: 'Mama Put Kitchen',
              shopLink: 'https://example.test/shops/shop1',
              printLink: 'https://example.test/ambassador/check/K7Q2MA?next=%2Fshops%2Fshop1',
            })
          : null,
    );
    const { container } = renderAt('/ambassador/print/card/shop1');
    await screen.findByRole('heading', { name: 'Counter card for Mama Put Kitchen' });
    const area = container.querySelector('.print-area')!;
    expect(area).toHaveTextContent(WORDS);
    expect(area.querySelector('[data-qr-value]')).toHaveAttribute(
      'data-qr-value',
      'https://example.test/ambassador/check/K7Q2MA?next=%2Fshops%2Fshop1',
    );
  });

  it('is on every presentation slide', async () => {
    stubWith((_method, path) => (path === '/ambassador/toolkit' ? reply(TOOLKIT) : null));
    renderAt('/ambassador/presentation');
    const deck = await screen.findByRole('region', { name: /^Presentation/ });
    const slides = within(deck).getAllByRole('group', { hidden: true });
    expect(slides).toHaveLength(6);
    for (const slide of slides) expect(slide).toHaveTextContent(WORDS);
    expect(deck.querySelector('[data-qr-value]')).toHaveAttribute(
      'data-qr-value',
      TOOLKIT.printLinks.business,
    );
  });
});

describe('Check an Ambassador', () => {
  function showCheck(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/ambassador/check" element={<AmbassadorCheck />} />
          <Route path="/ambassador/check/:code" element={<AmbassadorCheck />} />
          <Route path="/business/join" element={<p>The business join</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('shows an active Ambassador by first name, with the date approved, then carries on to the sign-up', async () => {
    stubOnly((_method, path) =>
      path === '/ambassador/check/K7Q2MA'
        ? reply({
            known: true,
            code: 'K7Q2MA',
            active: true,
            firstName: 'Ada',
            approvedAt: '2026-11-12T11:00:00.000Z',
            approvedWords: '12 November 2026',
            hasPhoto: true,
            words: 'Ada is an active Ambassador, approved on 12 November 2026.',
          })
        : reply({ error: { message: 'Not found' } }, 404),
    );
    const user = userEvent.setup({ delay: null });
    const { container } = showCheck('/ambassador/check/K7Q2MA?next=%2Fbusiness%2Fjoin');
    expect(await screen.findByRole('heading', { name: 'Active: Ada' })).toBeInTheDocument();
    expect(screen.getByText('12 November 2026')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Ada, the Ambassador with this code' }),
    ).toHaveAttribute('src', expect.stringContaining('/ambassador/check/K7Q2MA/photo'));
    await noViolations(container);
    await user.click(screen.getByRole('link', { name: 'Carry on' }));
    expect(await screen.findByText('The business join')).toBeInTheDocument();
  });

  it('never carries on to another site', async () => {
    stubOnly(() =>
      reply({
        known: true,
        code: 'K7Q2MA',
        active: true,
        firstName: 'Ada',
        approvedAt: null,
        approvedWords: null,
        hasPhoto: false,
        words: 'Ada is an active Ambassador.',
      }),
    );
    showCheck('/ambassador/check/K7Q2MA?next=https%3A%2F%2Fevil.example');
    await screen.findByRole('heading', { name: 'Active: Ada' });
    expect(screen.queryByRole('link', { name: 'Carry on' })).not.toBeInTheDocument();
  });

  it('says "Not active" with a report button, and does not carry on', async () => {
    const sent = stubOnly((method, path) =>
      method === 'POST'
        ? reply({ message: 'Thank you. We have told the founder, who will look into it.' })
        : path === '/ambassador/check/K7Q2MA'
          ? reply({
              known: true,
              code: 'K7Q2MA',
              active: false,
              firstName: 'Ada',
              approvedAt: null,
              approvedWords: null,
              hasPhoto: false,
              words: "Not active. Please do not deal with this person on Ozi's behalf. Report it.",
            })
          : reply({}, 404),
    );
    const user = userEvent.setup({ delay: null });
    const { container } = showCheck('/ambassador/check/K7Q2MA?next=%2Fbusiness%2Fjoin');
    expect(
      await screen.findByRole('heading', {
        name: "Not active. Please do not deal with this person on Ozi's behalf. Report it.",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Carry on' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    await noViolations(container);
    await user.type(screen.getByLabelText('What happened (optional)'), 'Asked me for cash.');
    await user.click(screen.getByRole('button', { name: 'Report it' }));
    expect(
      await screen.findByText('Thank you. We have told the founder, who will look into it.'),
    ).toBeInTheDocument();
    expect(sent.find((row) => row.method === 'POST')).toEqual({
      method: 'POST',
      path: '/ambassador/check/K7Q2MA/report',
      body: { note: 'Asked me for cash.' },
    });
  });

  it('takes a typed code, and says when it does not know it', async () => {
    stubOnly(() => reply({ known: false, code: 'ZZZZZZ', words: "We don't know this code." }));
    const user = userEvent.setup({ delay: null });
    const { container } = showCheck('/ambassador/check');
    await noViolations(container);
    await user.type(screen.getByLabelText('The Ambassador’s code'), 'zzzzzz');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(
      await screen.findByRole('heading', { name: "We don't know this code." }),
    ).toBeInTheDocument();
  });
});

describe('the partner dashboard', () => {
  const VIEW = {
    freeJoiningWords: WORDS,
    costLines: {
      joining: 'Joining: free.',
      preferred:
        'Preferred Partner: free. You earn it by giving Ozi a discount of 20% or more. It comes with free Partner Plus and a free Spotlight week each month.',
      extras:
        'Spotlight and Partner Plus: paid and optional (Spotlight £19.99 a month and Partner Plus £14.99 a month). You only pay if you choose them.',
    },
    ambassador: { firstName: 'Ada', confirmed: false, confirmedAt: null, waiting: true },
    promise: { question: "Were you promised anything that isn't in your agreement?" },
  };

  it('keeps the warning and the three lines, confirms the Ambassador with the code, asks once, and takes a report', async () => {
    const sent = stubOnly((method, path) => {
      if (path === '/partner/ambassador') return reply(VIEW);
      if (path === '/partner/ambassador/confirm') {
        return reply({
          message: 'Thank you. You have confirmed that Ada introduced your business.',
          confirmed: true,
          view: VIEW,
        });
      }
      if (method === 'POST') return reply({ message: 'Thank you for telling us.' });
      return reply({}, 404);
    });
    const user = userEvent.setup({ delay: null });
    const { container } = render(<PartnerProtection />);
    const box = (await screen.findByRole('heading', { name: 'Joining is free' })).closest(
      'section',
    )!;
    expect(box).toHaveTextContent(WORDS);
    expect(
      within(box)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([VIEW.costLines.joining, VIEW.costLines.preferred, VIEW.costLines.extras]);
    await noViolations(container);

    await user.type(screen.getByLabelText('The code from the text'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(
      await screen.findByText('Thank you. You have confirmed that Ada introduced your business.'),
    ).toBeInTheDocument();
    expect(sent.find((row) => row.path === '/partner/ambassador/confirm')?.body).toEqual({
      code: '123456',
    });

    const question = screen.getByRole('group', { name: VIEW.promise.question });
    await user.click(within(question).getByLabelText('Yes'));
    await user.type(screen.getByLabelText('What were you promised?'), 'A free year.');
    await user.click(screen.getByRole('button', { name: 'Send my answer' }));
    await waitFor(() =>
      expect(sent.find((row) => row.path === '/partner/ambassador/promise')?.body).toEqual({
        answer: 'yes',
        note: 'A free year.',
      }),
    );

    await user.type(screen.getByLabelText('What happened'), 'Asked for twenty pounds.');
    await user.click(screen.getByRole('button', { name: 'Send the report' }));
    await waitFor(() =>
      expect(sent.find((row) => row.path === '/partner/ambassador/report')?.body).toEqual({
        who: '',
        note: 'Asked for twenty pounds.',
      }),
    );
  });
});

describe('staff', () => {
  it('opens links to check a business, filled in, never looking anything up itself', async () => {
    const sent = stubOnly(() =>
      reply({
        name: 'Mama Put Kitchen',
        postcode: 'ME7 5TP',
        companiesHouse:
          'https://find-and-update.company-information.service.gov.uk/search/companies?q=Mama%20Put%20Kitchen',
        hygieneRating:
          'https://ratings.food.gov.uk/search?name=Mama%20Put%20Kitchen&location=ME7%205TP',
        ambassadorConfirmedAt: '2026-11-12T11:00:00.000Z',
        claims: [],
      }),
    );
    const user = userEvent.setup({ delay: null });
    const { container } = render(
      <CheckThisBusiness staffKey="key" shopId="shop1" shopName="Mama Put Kitchen" />,
    );
    await user.click(screen.getByRole('button', { name: 'Check this business Mama Put Kitchen' }));
    expect(
      await screen.findByRole('link', { name: 'Companies House search (opens in a new tab)' }),
    ).toHaveAttribute('href', expect.stringContaining('q=Mama%20Put%20Kitchen'));
    expect(
      screen.getByRole('link', { name: 'Food hygiene rating search (opens in a new tab)' }),
    ).toHaveAttribute('href', expect.stringContaining('ME7%205TP'));
    expect(sent.every((row) => !/gov\.uk/.test(row.path))).toBe(true);
    await noViolations(container);
  });

  it('lists held shares with Release and Cancel', async () => {
    const sent = stubOnly((method) =>
      method === 'POST'
        ? reply({ message: 'The share of £0.12 is released, by Anthony.' })
        : reply({
            held: [
              {
                id: 'e1',
                ambassadorName: 'Ada Obi',
                business: 'Corner Shop',
                orderId: 'o1',
                amountPence: 12,
                amountWords: '£0.12',
                heldAt: '2026-11-12T11:00:00.000Z',
                reason: "The Shopper's phone number is the Ambassador's own.",
              },
            ],
          }),
    );
    const news = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<HeldShares staffKey="key" by="Anthony" onNews={news} />);
    expect(
      await screen.findByText(/The Shopper's phone number is the Ambassador's own/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Release the share for Ada Obi' }));
    await waitFor(() =>
      expect(news).toHaveBeenCalledWith('The share of £0.12 is released, by Anthony.'),
    );
    expect(sent.find((row) => row.method === 'POST')?.path).toBe(
      '/staff/ambassador-protection/held/e1/release',
    );
  });
});
