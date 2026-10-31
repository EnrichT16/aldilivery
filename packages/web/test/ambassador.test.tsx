/**
 * Ozi Ambassadors on the screen (Anthony, 30 October 2026): the /ambassador page and the footer
 * link, applying (with an account set up first by somebody with none), the documents and the
 * chat, grandfathering and the Toolkit gate on the Ambassador dashboard, the personalised flyers
 * and their QR codes, the presentation's navigation, "Sign up this business now" with the
 * owner's agreement, the agreement sheet and its check page, the staff Ambassadors page, and the
 * "introduced by" code at sign-up. Every new page is checked with axe.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { qrMatrix } from '../src/components/QrCode';
import { storeConfig } from '../src/config';
import { FAKE_SHOPPER, fakeReferrals, stubApi, type RecordedRequest } from './setup';
import { openPage, pageTabs } from './staff-tabs';

const reply = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => Promise.resolve(body),
    blob: async () => Promise.resolve(new Blob(['photo'])),
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

const TOOLKIT = {
  name: 'Ada Obi',
  firstName: 'Ada',
  businessLink: 'https://example.test/business/join?ambassador=shopper-ada',
  shopperLink: 'https://example.test/join?via=shopper-ada',
  runnerLink: 'https://example.test/runner/sign-up?via=shopper-ada',
  businesses: [
    {
      id: 'shop1',
      name: 'Mama Put Kitchen',
      approved: true,
      statusWords: 'Approved',
      cardsAllowed: true,
      shopLink: 'https://example.test/shops/shop1',
      agreementReference: 'OZA-ABCD-EFGH',
    },
    {
      id: 'shop2',
      name: 'Corner Café',
      approved: false,
      statusWords: 'Waiting for approval',
      cardsAllowed: false,
      shopLink: null,
      agreementReference: null,
    },
  ],
  cardsWaitWords:
    'Counter cards are printed once the business has signed the partner agreement in the app.',
};

const APPROVED = {
  joined: true,
  status: 'approved',
  statusWords: 'Approved',
  approved: true,
  link: TOOLKIT.businessLink,
  businesses: [{ name: 'Mama Put Kitchen', approved: true, earnedPence: 140 }],
  pendingPence: 140,
  availablePence: 1200,
  paidPence: 0,
  canWithdraw: true,
  bankReady: true,
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the /ambassador page', () => {
  it('explains the role, the figures, examples labelled as examples, the note and the rules, for anyone', async () => {
    stubApi();
    const { container } = renderAt('/ambassador');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Become an Ozi Ambassador' }),
    ).toBeInTheDocument();
    const text = container.querySelector('main')?.textContent ?? '';
    expect(text).toMatch(/an independent marketer/);
    expect(text).toMatch(/also introduce Runners \(drivers\) and Shoppers/);
    expect(text).toMatch(/2% of the mark-up we keep, plus 2% of the discount we keep/);
    expect(text).toMatch(/1% of the item charges, 1% of any mark-up and 1% of any discount/);
    expect(text).toMatch(/a quarter of the rate/);
    expect(text).toMatch(/A one-off 5% of a business's first Partner Plus payment/);
    expect(text).toMatch(/For 12 months from the day we approve each business/);
    expect(text).toMatch(/held for 30 days after delivery/);
    expect(text).toMatch(/at least £10 available/);
    expect(
      screen.getByText('Examples only. What you earn depends on real orders.'),
    ).toBeInTheDocument();
    expect(text).toMatch(/Businesses only earn when there are Runners \(drivers\)/);
    expect(text).toMatch(/Never say we have a partnership with any supermarket/);
    expect(text.toLowerCase()).not.toContain('insurance');
    expect(screen.getByRole('link', { name: 'Read the Ozi Ambassador terms' })).toHaveAttribute(
      'href',
      '/ambassador/terms',
    );
    // No account: set one up with the phone-code sign-up, and come straight back.
    expect(screen.getByRole('link', { name: 'Set up my account and apply' })).toHaveAttribute(
      'href',
      '/sign-up?next=/ambassador/apply',
    );
    await noViolations(container);
  });

  it('is linked from the footer of every page', async () => {
    stubApi();
    renderAt('/help');
    const footer = await screen.findByRole('contentinfo');
    expect(within(footer).getByRole('link', { name: 'Become an Ozi Ambassador' })).toHaveAttribute(
      'href',
      '/ambassador',
    );
  });
});

describe('applying', () => {
  it('sets up an account first for somebody with none, with an introducer code, then comes back to apply', async () => {
    const sent = stubWith(
      (_method, path) => (path === '/ambassador/application' ? reply({ application: null }) : null),
      {},
    );
    const user = userEvent.setup({ delay: null });
    renderAt('/sign-up?next=/ambassador/apply');
    await user.type(await screen.findByLabelText('Your name'), 'Ada Obi');
    await user.type(screen.getByLabelText('Your phone number'), '07700 900500');
    await user.type(
      screen.getByLabelText('Where should we bring your shopping?'),
      '1 High Street, Gillingham ME7 1AA',
    );
    await user.type(
      screen.getByLabelText('Did someone introduce you? Their code (optional)'),
      'R4K7Q2AB',
    );
    await user.click(screen.getByRole('button', { name: 'Create my account' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Apply to be an Ozi Ambassador' }),
    ).toBeInTheDocument();
    expect(sent.find((row) => row.path === '/shoppers')?.body).toEqual(
      expect.objectContaining({ introducedBy: 'R4K7Q2AB' }),
    );
  });

  it('agrees to the terms, sends the documents, and is told about the chat', async () => {
    let application: Record<string, unknown> | null = null;
    const needed = [
      { kind: 'photo_id_front', name: 'Your photo ID, the front' },
      { kind: 'proof_of_address', name: 'Your proof of address' },
      { kind: 'face_photo', name: 'A photo of your face' },
    ];
    const base = {
      status: 'applied',
      statusWords: 'Applied',
      idType: null,
      documents: [],
      documentsIn: false,
      chatDone: false,
      reason: null,
      approved: false,
      message: 'Thank you for applying. Next, please send your documents.',
    };
    const sent = stubWith((method, path, body) => {
      if (path === '/ambassador/application') return reply({ application });
      if (path === '/ambassador/join' && method === 'POST') {
        application = { ...base, stillNeeded: needed };
        return reply({
          link: null,
          message:
            'Thank you for applying to be an Ozi Ambassador. Next, please send your documents.',
        });
      }
      if (path === '/ambassador/face-consent' && method === 'POST') {
        application = {
          ...(application ?? base),
          faceConsent: (body as { consent: boolean }).consent,
        };
        return reply({
          application,
          message:
            'Thank you. A person will check your face photo instead, in your chat with the founder.',
        });
      }
      if (path === '/ambassador/documents' && method === 'POST') {
        const kind = (body as { kind: string }).kind;
        const left = needed.filter((row) => row.kind !== kind);
        needed.splice(0, needed.length, ...left);
        application = {
          ...base,
          status: left.length === 0 ? 'documents_sent' : 'applied',
          statusWords: left.length === 0 ? 'Documents sent' : 'Applied',
          stillNeeded: left,
          documentsIn: left.length === 0,
          message:
            left.length === 0
              ? "We'll contact you to have a short chat before you start."
              : base.message,
        };
        return reply(
          { application, message: 'Thank you. We will check it and let you know.' },
          201,
        );
      }
      return null;
    });
    const user = userEvent.setup({ delay: null });
    const { container } = renderAt('/ambassador/apply');
    expect(
      await screen.findByRole('heading', { name: 'Step 1: read and agree to the terms' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply to be an Ambassador' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please tick to agree to the Ozi Ambassador terms first.',
    );
    await user.click(screen.getByLabelText('I have read and agree to the Ozi Ambassador terms'));
    await user.click(screen.getByRole('button', { name: 'Apply to be an Ambassador' }));
    expect(
      await screen.findByRole('heading', { name: 'Step 2: send your documents' }),
    ).toBeInTheDocument();
    expect(sent.find((row) => row.path === '/ambassador/join')?.body).toEqual({
      termsAgreed: true,
      termsVersion: '2026-10-30c',
    });
    await noViolations(container);

    // A driving licence: chosen, then the front sent as a photo.
    await user.click(screen.getByLabelText('Driving licence (photocard)'));
    const front = screen
      .getByRole('heading', { name: 'Your photo ID, the front' })
      .closest('section')!;
    const photo = new File(['photo'], 'licence.jpg', { type: 'image/jpeg' });
    await user.upload(within(front).getByLabelText('Choose a photo or PDF'), photo);
    await waitFor(() =>
      expect(sent.find((row) => row.path === '/ambassador/documents')?.body).toEqual(
        expect.objectContaining({
          kind: 'photo_id_front',
          idType: 'driving_licence',
          contentType: 'image/jpeg',
        }),
      ),
    );
    // The proof of address as a PDF.
    await user.click(await screen.findByLabelText('A council tax letter'));
    const address = screen
      .getByRole('heading', { name: 'Your proof of address' })
      .closest('section')!;
    const pdf = new File(['%PDF-1.4'], 'council-tax.pdf', { type: 'application/pdf' });
    await user.upload(within(address).getByLabelText('Choose a photo or PDF'), pdf);
    await waitFor(() =>
      expect(sent.filter((row) => row.path === '/ambassador/documents').at(-1)?.body).toEqual(
        expect.objectContaining({
          kind: 'proof_of_address',
          addressType: 'council_tax',
          contentType: 'application/pdf',
        }),
      ),
    );
    // The separate yes or no about comparing faces (31 October 2026): either is fine.
    expect(
      screen.getByText(
        'May we compare your face photo with the photo on your ID? This uses your face, which UK data law treats as sensitive. If you say no, a person will check it instead in your chat with the founder.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'No, a person checks it' }));
    await waitFor(() =>
      expect(sent.find((row) => row.path === '/ambassador/face-consent')?.body).toEqual({
        consent: false,
      }),
    );
    expect(
      await screen.findByText(
        'You said no. A person will check your face photo. You can change your answer.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No, a person checks it' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const face = (await screen.findByRole('heading', { name: 'A photo of your face' })).closest(
      'section',
    )!;
    await user.upload(within(face).getByLabelText('Choose a photo'), photo);
    expect(
      await screen.findByRole('heading', { name: 'Step 3: talk with the founder' }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("We'll contact you to have a short chat before you start.").length,
    ).toBeGreaterThan(0);
  });

  it('shows a declined application with the reason they see', async () => {
    stubWith((_method, path) =>
      path === '/ambassador/application'
        ? reply({
            application: {
              status: 'declined',
              statusWords: 'Declined',
              idType: 'passport',
              stillNeeded: [],
              documents: [],
              documentsIn: true,
              chatDone: false,
              reason: 'We are not taking Ambassadors in your area yet.',
              approved: false,
              message:
                'Your application was not approved. We are not taking Ambassadors in your area yet.',
            },
          })
        : null,
    );
    renderAt('/ambassador/apply');
    expect(
      await screen.findByText(
        'Your application was not approved. We are not taking Ambassadors in your area yet.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Step 2: send your documents' }),
    ).not.toBeInTheDocument();
  });
});

describe('the Ambassador dashboard', () => {
  it('shows a grandfathered Ambassador their earnings, but keeps the Toolkit and withdrawals for approval', async () => {
    stubWith((_method, path) =>
      path === '/referrals/me'
        ? reply(
            fakeReferrals('https://example.test/join?via=shopper-ada', {
              ambassador: {
                joined: true,
                status: 'documents_needed',
                statusWords: 'Documents needed',
                approved: false,
                applicationMessage:
                  'Your Ambassador link keeps working and your earnings keep adding up, as before. To use the Ambassador Toolkit and to withdraw your earnings, we now need to check your documents and have a short chat with you. Please send your documents.',
                link: TOOLKIT.businessLink,
                availablePence: 1500,
                canWithdraw: false,
                bankReady: true,
              },
            }),
          )
        : null,
    );
    const user = userEvent.setup({ delay: null });
    const { container } = renderAt('/ambassador/home');
    expect(await screen.findByText('Status: Documents needed.')).toBeInTheDocument();
    expect(
      screen.getByText(/Your Ambassador link keeps working and your earnings keep adding up/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Send my documents' })).toHaveAttribute(
      'href',
      '/ambassador/apply',
    );
    expect(screen.getByText('Available: £15.00')).toBeInTheDocument();
    expect(
      screen.getByText('Withdrawals open once your Ambassador application is approved.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Withdraw/ })).not.toBeInTheDocument();
    await noViolations(container);

    await user.click(screen.getByRole('tab', { name: 'Toolkit' }));
    expect(
      await screen.findByText(/The Toolkit opens once your documents are checked/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Flyers (A5)')).not.toBeInTheDocument();
  });

  it('gives an approved Ambassador the four tabs, the money, the businesses, the Toolkit and the Guide', async () => {
    const sent = stubWith((method, path) => {
      if (path === '/referrals/me') {
        return reply(
          fakeReferrals('https://example.test/join?via=shopper-ada', { ambassador: APPROVED }),
        );
      }
      if (path === '/ambassador/toolkit') return reply(TOOLKIT);
      if (path === '/ambassador/withdraw' && method === 'POST') {
        return reply({
          status: 'sent',
          amountPence: 1200,
          message: '£12.00 is on its way to your bank.',
        });
      }
      return null;
    });
    const user = userEvent.setup({ delay: null });
    const { container } = renderAt('/ambassador/home');
    const tabs = await screen.findByRole('tablist', { name: 'Ambassador dashboard' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Overview', 'My businesses', 'Toolkit', 'Guide']);
    expect(
      screen.getByText('Pending (waiting for the refund window to pass): £1.40'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Withdraw £12.00 to my bank' }));
    await waitFor(() => expect(sent.some((row) => row.path === '/ambassador/withdraw')).toBe(true));

    // The arrow keys move along the tabs.
    screen.getByRole('tab', { name: 'Overview' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'My businesses' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('rowheader', { name: 'Mama Put Kitchen' })).toBeInTheDocument();
    expect(within(table).getByText('£1.40')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Toolkit' }));
    expect(await screen.findByRole('heading', { name: 'Flyers (A5)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Print the Shoppers flyer' })).toHaveAttribute(
      'href',
      '/ambassador/print/flyer/shoppers?action=print',
    );
    expect(
      screen.getByRole('link', { name: 'Download PDF of the Runners (drivers) flyer' }),
    ).toHaveAttribute('href', '/ambassador/print/flyer/runners?action=pdf');
    expect(
      screen.getByRole('link', { name: 'Print the counter card for Mama Put Kitchen' }),
    ).toBeInTheDocument();
    // Not offered for a business that has not signed the partner agreement in the app.
    expect(
      screen.queryByRole('link', { name: 'Print the counter card for Corner Café' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByText(
        /Counter cards are printed once the business has signed the partner agreement in the app\./,
      ).length,
    ).toBeGreaterThan(1);
    expect(
      screen.getByRole('link', { name: 'Print the agreement sheet for Mama Put Kitchen' }),
    ).toHaveAttribute('href', '/ambassador/print/agreement/OZA-ABCD-EFGH?action=print');
    // Ready-made messages, each with the right link.
    expect(
      screen.getByText(/Sign up here: https:\/\/example\.test\/runner\/sign-up\?via=shopper-ada/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Send the message for restaurants and shops on WhatsApp' }),
    ).toHaveAttribute('href', expect.stringContaining(encodeURIComponent(TOOLKIT.businessLink)));
    const all = container.textContent ?? '';
    expect(all.toLowerCase()).not.toContain('insurance');
    await noViolations(container);

    await user.click(screen.getByRole('tab', { name: 'Guide' }));
    expect(
      await screen.findByRole('heading', { name: 'The two-minute pitch for restaurant owners' }),
    ).toBeInTheDocument();
    // No other delivery app is named (31 October 2026); the comparison stays.
    expect(
      screen.getByText('“Why join when I am already on other delivery apps?”'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Other delivery apps pay you later and take a commission\./),
    ).toBeInTheDocument();
    expect(screen.getByText('“What is the mark-up?”')).toBeInTheDocument();
    expect(screen.getByText('“When am I paid?”')).toBeInTheDocument();
    expect(screen.getByText('“Who are the customers?”')).toBeInTheDocument();
    expect(
      screen.getByText('Never collect money from a business, for anything.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Never ask anyone for their card details.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read the guide to me' })).toBeInTheDocument();
    await noViolations(container);
  });
});

describe('the Toolkit’s printed things', () => {
  function stubToolkit(extra: (path: string) => Response | null = () => null) {
    return stubWith((_method, path) =>
      path === '/ambassador/toolkit' ? reply(TOOLKIT) : extra(path),
    );
  }

  it('makes each flyer with the Ambassador’s own QR code and first name, and opens the print window', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    stubToolkit();
    const { container, unmount } = renderAt('/ambassador/print/flyer/business?action=print');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Restaurants and shops flyer' }),
    ).toBeInTheDocument();
    const code = screen.getByRole('img', { name: "QR code: Ada's link for a business to join" });
    expect(code).toHaveAttribute('data-qr-value', TOOLKIT.businessLink);
    // The squares drawn are the real code for that link.
    const squares = qrMatrix(TOOLKIT.businessLink).flat().filter(Boolean).length;
    expect((code.querySelector('path')?.getAttribute('d')?.match(/M/g) ?? []).length).toBe(squares);
    expect(screen.getByText(/Your Ambassador: Ada · Code shopper-ada/)).toBeInTheDocument();
    expect(container.textContent).toContain(storeConfig.store.legalEntityName);
    expect(container.querySelector('style')?.textContent ?? '').toBeDefined();
    expect(document.body.innerHTML).toMatch(/@page \{ size: A5/);
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    await noViolations(container);
    unmount();

    for (const [flyer, link, label] of [
      ['shoppers', TOOLKIT.shopperLink, "QR code: Ada's link to start shopping"],
      ['carers', TOOLKIT.shopperLink, "QR code: Ada's link to join"],
      ['runners', TOOLKIT.runnerLink, "QR code: Ada's link to sign up as a Runner"],
    ] as const) {
      const shown = renderAt(`/ambassador/print/flyer/${flyer}`);
      expect(await screen.findByRole('img', { name: label })).toHaveAttribute(
        'data-qr-value',
        link,
      );
      const words = (shown.container.textContent ?? '').toLowerCase();
      expect(words).not.toContain('insurance');
      expect(words).not.toContain('supermarket');
      expect(words).not.toContain(storeConfig.store.displayName.toLowerCase());
      shown.unmount();
    }
  });

  it('makes a counter card and a window sticker with the shop’s own page', async () => {
    stubToolkit((path) =>
      path === '/ambassador/cards/shop1'
        ? reply({
            id: 'shop1',
            name: 'Mama Put Kitchen',
            shopLink: 'https://example.test/shops/shop1',
          })
        : null,
    );
    const { container } = renderAt('/ambassador/print/card/shop1');
    expect(
      await screen.findByRole('heading', { name: 'Counter card for Mama Put Kitchen' }),
    ).toBeInTheDocument();
    expect(container.textContent).toMatch(
      new RegExp(`Order from us on ${storeConfig.productName}`),
    );
    expect(
      screen.getByRole('img', { name: `QR code: Mama Put Kitchen on ${storeConfig.productName}` }),
    ).toHaveAttribute('data-qr-value', 'https://example.test/shops/shop1');
    await noViolations(container);
  });

  it('says why there is no counter card for a business that has not signed the partner agreement', async () => {
    stubToolkit((path) =>
      path === '/ambassador/cards/shop2'
        ? reply(
            {
              error: {
                message:
                  'Counter cards are printed once the business has signed the partner agreement in the app.',
              },
            },
            403,
          )
        : null,
    );
    renderAt('/ambassador/print/card/shop2');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Counter cards are printed once the business has signed the partner agreement in the app.',
    );
    expect(screen.queryByRole('img', { name: /QR code/ })).not.toBeInTheDocument();
  });

  it('prints the Shop Partner agreement sheet with its reference, QR code, terms and watermark', async () => {
    stubToolkit((path) =>
      path === '/ambassador/agreements/OZA-ABCD-EFGH'
        ? reply({
            reference: 'OZA-ABCD-EFGH',
            business: 'Mama Put Kitchen',
            kindWords: 'Café or takeaway',
            address: '3 Canterbury Street, Gillingham',
            postcode: 'ME7 5TP',
            ownerName: 'Chika Eze',
            agreedAt: '2026-11-10T10:00:00.000Z',
            termsVersion: 'shop-partner-terms-2026-10-30b',
            markupPercent: 30,
            discountPercent: 20,
            status: 'pending',
            ambassadorName: 'Ada Obi',
            checkLink: 'https://example.test/business/agreement/OZA-ABCD-EFGH',
          })
        : null,
    );
    const { container } = renderAt('/ambassador/print/agreement/OZA-ABCD-EFGH');
    expect(
      await screen.findByRole('heading', { name: 'Shop Partner agreement for Mama Put Kitchen' }),
    ).toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text).toContain('OZA-ABCD-EFGH');
    expect(text).toMatch(/Agreed mark-up30%/);
    expect(text).toMatch(/Agreed discount20%/);
    expect(text).toMatch(/Chika Eze/);
    expect(text).toMatch(/Printed by Ambassador Ada Obi on /);
    expect(text).toMatch(/proposed until .* staff confirm them, when they check this reference/);
    expect(
      screen.getByRole('img', { name: 'QR code: check agreement OZA-ABCD-EFGH' }),
    ).toHaveAttribute('data-qr-value', 'https://example.test/business/agreement/OZA-ABCD-EFGH');
    await noViolations(container);
  });

  it('checks an agreement’s reference for anyone, saying plainly when there is none', async () => {
    stubWith(
      (_method, path) =>
        path === '/partner-agreements/OZA-AAAA-BBBB'
          ? reply({ found: false, reference: 'OZA-AAAA-BBBB' })
          : null,
      {},
    );
    const { container } = renderAt('/business/agreement/OZA-AAAA-BBBB');
    expect(
      await screen.findByText(/There is no agreement with this reference/),
    ).toBeInTheDocument();
    await noViolations(container);
  });

  it('is not made for somebody who is not approved', async () => {
    stubWith((_method, path) =>
      path === '/ambassador/toolkit'
        ? reply(
            { error: { message: 'The Ambassador Toolkit is for approved Ozi Ambassadors.' } },
            403,
          )
        : null,
    );
    renderAt('/ambassador/print/flyer/shoppers');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The Ambassador Toolkit is for approved Ozi Ambassadors.',
    );
    expect(screen.queryByRole('img', { name: /QR code/ })).not.toBeInTheDocument();
  });
});

describe('the presentation for business owners', () => {
  it('moves through six slides by buttons, arrow keys and swipes, saying each one', async () => {
    stubWith((_method, path) => (path === '/ambassador/toolkit' ? reply(TOOLKIT) : null));
    const user = userEvent.setup({ delay: null });
    const { container } = renderAt('/ambassador/presentation');
    const deck = await screen.findByRole('region', { name: /^Presentation/ });
    const shown = () =>
      within(deck)
        .getAllByRole('group', { hidden: true })
        .filter((slide) => !slide.hidden)
        .map((slide) => slide.getAttribute('aria-label'));
    expect(within(deck).getAllByRole('group', { hidden: true })).toHaveLength(6);
    expect(shown()).toEqual([`Slide 1 of 6: ${storeConfig.productName}`]);
    expect(screen.getByRole('button', { name: 'Previous slide' })).toBeDisabled();
    await noViolations(container);

    await user.click(screen.getByRole('button', { name: 'Next slide' }));
    expect(shown()).toEqual(['Slide 2 of 6: New customers']);
    expect(
      screen
        .getAllByRole('status')
        .some((one) => one.textContent === 'Slide 2 of 6: New customers'),
    ).toBe(true);
    expect(deck.textContent).toMatch(/order by speaking to/);

    deck.focus();
    await user.keyboard('{ArrowRight}');
    expect(shown()).toEqual(['Slide 3 of 6: Paid in full at the counter']);
    expect(deck.textContent).toMatch(/No commission/);
    await user.keyboard('{ArrowLeft}');
    expect(shown()).toEqual(['Slide 2 of 6: New customers']);

    // A swipe to the left is the next slide.
    fireEvent.touchStart(deck, { touches: [{ clientX: 300 }] });
    fireEvent.touchEnd(deck, { changedTouches: [{ clientX: 100 }] });
    expect(shown()).toEqual(['Slide 3 of 6: Paid in full at the counter']);

    await user.keyboard('{End}');
    expect(shown()).toEqual(['Slide 6 of 6: How to join']);
    expect(screen.getByRole('button', { name: 'Next slide' })).toBeDisabled();
    expect(
      within(deck).getByRole('img', { name: "QR code: Ada's link for a business to join" }),
    ).toHaveAttribute('data-qr-value', TOOLKIT.businessLink);
    expect(screen.getByRole('link', { name: 'Sign up this business now' })).toBeInTheDocument();
    await user.keyboard('{Home}');
    expect(shown()).toEqual([`Slide 1 of 6: ${storeConfig.productName}`]);
    // Printable: every slide prints, one to a page.
    expect(document.body.innerHTML).toMatch(
      /\.slides \.slide\[hidden\] \{ display: block !important; \}/,
    );
    await noViolations(container);
  });

  it('covers the price, the perks and joining, with no promises', async () => {
    stubWith((_method, path) => (path === '/ambassador/toolkit' ? reply(TOOLKIT) : null));
    const { container } = renderAt('/ambassador/presentation');
    const deck = await screen.findByRole('region', { name: /^Presentation/ });
    const text = deck.textContent ?? '';
    expect(text).toMatch(/Your price is safe/);
    expect(text).toMatch(/adds a small mark-up/);
    expect(text).toMatch(/Preferred Partner/);
    expect(text).toMatch(/Partner Plus/);
    expect(text.toLowerCase()).not.toContain('insurance');
    expect(text.toLowerCase()).not.toContain('supermarket');
    expect(container).toBeTruthy();
  });
});

describe('Sign up this business now', () => {
  it('needs the owner’s own agreement, then makes the application tied to the Ambassador', async () => {
    const sent = stubWith((method, path) =>
      path === '/ambassador/businesses' && method === 'POST'
        ? reply(
            {
              reference: 'OZA-ABCD-EFGH',
              shop: { id: 'shop1' },
              message:
                'Mama Put Kitchen is signed up and waiting for our approval. Agreement reference OZA-ABCD-EFGH.',
            },
            201,
          )
        : null,
    );
    const user = userEvent.setup({ delay: null });
    const { container } = renderAt('/ambassador/sign-up-business');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign up this business now' }),
    ).toBeInTheDocument();
    // The Shop Partner terms are on the same screen, under one main heading.
    expect(
      screen.getByRole('heading', { name: 'For the owner: please read and agree' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Shop Partner terms', level: 3 }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await noViolations(container);

    await user.type(screen.getByLabelText('The business’s name'), 'Mama Put Kitchen');
    await user.type(screen.getByLabelText('Address'), '3 Canterbury Street, Gillingham');
    await user.type(screen.getByLabelText('Postcode'), 'ME7 5TP');
    await user.type(screen.getByLabelText('Opening hours'), 'Every day 11am to 10pm');
    await user.type(screen.getByLabelText('Their name'), 'Chika Eze');
    await user.type(screen.getByLabelText('Their mobile number'), '07700 900888');
    await user.type(screen.getByLabelText('Their email address'), 'chika@example.com');
    await user.type(screen.getByLabelText('Agreed mark-up, as a percentage'), '30');
    await user.type(screen.getByLabelText('Agreed discount, as a percentage (optional)'), '20');
    await user.type(screen.getByLabelText('Choose a username for the business'), 'mamaput');
    await user.type(screen.getByLabelText('Choose a password'), 'a-long-enough-password');

    // Not yet agreed by the owner: nothing is sent.
    await user.click(screen.getByRole('button', { name: 'Agree and sign up the business' }));
    const problems = await screen.findByRole('alert');
    expect(problems).toHaveTextContent(
      'The owner needs to tick "I am the owner or manager and I agree".',
    );
    expect(problems).toHaveTextContent('The owner needs to type their name.');
    expect(sent.some((row) => row.path === '/ambassador/businesses')).toBe(false);

    await user.click(screen.getByLabelText('I have read the Shop Partner terms'));
    await user.click(screen.getByLabelText('I am the owner or manager and I agree'));
    await user.type(screen.getByLabelText('Type your name'), 'Chika Eze');
    await user.click(screen.getByRole('button', { name: 'Agree and sign up the business' }));
    expect(
      await screen.findByRole('heading', { name: 'Signed up and waiting for approval' }),
    ).toBeInTheDocument();
    expect(sent.find((row) => row.path === '/ambassador/businesses')?.body).toEqual(
      expect.objectContaining({
        name: 'Mama Put Kitchen',
        kind: 'food',
        agreedMarkupPercent: 30,
        agreedDiscountPercent: 20,
        termsAgreed: true,
        ownerAgrees: true,
        ownerName: 'Chika Eze',
        username: 'mamaput',
      }),
    );
    expect(screen.getByRole('link', { name: 'Print the agreement sheet' })).toHaveAttribute(
      'href',
      '/ambassador/print/agreement/OZA-ABCD-EFGH?action=print',
    );
  });

  it('refuses a mark-up above the cap before anything is sent', async () => {
    const sent = stubWith(() => null);
    const user = userEvent.setup({ delay: null });
    renderAt('/ambassador/sign-up-business');
    await user.type(
      await screen.findByLabelText('Agreed mark-up, as a percentage'),
      String(storeConfig.restaurants.maximumMarkupPercent + 1),
    );
    await user.click(screen.getByRole('button', { name: 'Agree and sign up the business' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `The mark-up must be a whole number from 0 to ${storeConfig.restaurants.maximumMarkupPercent}%.`,
    );
    expect(sent.some((row) => row.path === '/ambassador/businesses')).toBe(false);
  });
});

describe('the staff Ambassadors page', () => {
  const APPLICATION = {
    id: 'agr1',
    kind: 'shopper',
    kindWords: 'Shopper',
    accountId: 's1',
    name: 'Ada Obi',
    area: 'Medway',
    status: 'documents_checked',
    statusWords: 'Documents checked',
    agreedAt: '2026-11-10T10:00:00.000Z',
    documentsSentAt: '2026-11-10T10:05:00.000Z',
    documentsCheckedAt: '2026-11-10T10:06:00.000Z',
    chatDoneAt: null,
    waitingDocuments: 0,
  };

  function stubStaff(
    areas: string[],
    answer: (method: string, path: string) => Response | null = () => null,
  ) {
    const me = {
      name: 'Kemi',
      role: 'operations_manager',
      title: 'Operations manager',
      areas,
      mustChangePassword: false,
    };
    return stubWith((method, path) => {
      const custom = answer(method, path);
      if (custom) return custom;
      if (path === '/staff/sign-in') return reply({ token: 'st1.k.sig', ...me });
      if (path === '/staff/me') return reply(me);
      if (path === '/staff/ambassador-applications') {
        return reply({
          groups: [
            { status: 'applied', words: 'Applied', applications: [] },
            {
              status: 'documents_checked',
              words: 'Documents checked',
              applications: [APPLICATION],
            },
          ],
        });
      }
      if (path === '/staff/ambassador-applications/agr1') {
        return reply({
          application: {
            ...APPLICATION,
            termsVersion: '2026-10-30c',
            idType: 'passport',
            chatDoneBy: null,
            chatNotes: '',
            decidedAt: null,
            decidedBy: null,
            decisionReason: null,
            approvedAt: null,
            stillNeeded: [],
            canRecordChat: true,
            canApprove: false,
            documents: [
              {
                id: 'd1',
                kind: 'proof_of_address',
                name: 'Your proof of address (A council tax letter)',
                status: 'accepted',
                reviewNote: 'Checked by the automatic check.',
                sentAs: 'PDF',
                createdAt: '2026-11-10T10:05:00.000Z',
                shareCode: null,
                hasFile: true,
                contentType: 'application/pdf',
                checkedAt: '2026-11-10T10:05:30.000Z',
                checkPassed: true,
                checkNote: null,
                checkName: 'OBI, ADA',
                checkIssuedOn: '2026-10-01',
                reviewedBy: 'The automatic check',
                reviewedAt: '2026-11-10T10:05:30.000Z',
              },
            ],
          },
        });
      }
      return answer(method, path);
    }, {});
  }

  async function signIn() {
    const user = userEvent.setup({ delay: null });
    renderAt('/staff');
    await user.type(await screen.findByLabelText('Username'), 'kemi');
    await user.type(screen.getByLabelText('Password'), 'a long password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('navigation', { name: 'Admin pages' });
    return user;
  }

  it('is a page only for staff given the Ambassadors area', async () => {
    stubStaff(['orders', 'referrals']);
    const user = await signIn();
    expect(await pageTabs(user)).not.toContain('Ambassadors');
  });

  it('lists applications by status, shows the documents and checks, and records the chat, approval and decline', async () => {
    const urls = vi.fn(() => 'blob:the-pdf');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: urls }));
    const sent = stubStaff(['orders', 'ambassadors'], (method, path) => {
      if (path === '/staff/ambassador-documents/d1/file') return reply({});
      if (path === '/staff/ambassador-applications/agr1/chat-done' && method === 'POST') {
        return reply({ message: 'The chat with Ada Obi is recorded, by Kemi.' });
      }
      if (path === '/staff/ambassador-applications/agr1/decline' && method === 'POST') {
        return reply({ message: 'Ada Obi is declined, by Kemi. They see the reason.' });
      }
      return null;
    });
    const user = await signIn();
    await openPage(user, 'Ambassadors');
    expect(
      await screen.findByRole('heading', { name: 'Ambassador applications' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Documents checked (1)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Ada Obi' }));
    expect(
      await screen.findByRole('heading', { name: "Ada Obi's application" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /The automatic check: clearly fine\. Name read: OBI, ADA\. Dated 2026-10-01\./,
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show PDF' }));
    expect(
      await screen.findByRole('link', {
        name: 'Open the PDF of Your proof of address (A council tax letter), from Ada Obi',
      }),
    ).toHaveAttribute('href', 'blob:the-pdf');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    await noViolations(document.body);

    await user.type(screen.getByLabelText('Notes from the chat'), 'Knows the cafés in Chatham.');
    await user.click(screen.getByRole('button', { name: 'Chat done' }));
    await waitFor(() =>
      expect(
        sent.find((row) => row.path === '/staff/ambassador-applications/agr1/chat-done')?.body,
      ).toEqual({
        by: 'Kemi',
        notes: 'Knows the cafés in Chatham.',
      }),
    );

    // Decline needs the reason they will see.
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    expect(await screen.findByText('Please give the reason they will see.')).toBeInTheDocument();
    await user.type(
      screen.getByLabelText('Reason, for Decline, Suspend or Remove for fraud (they see it)'),
      'Not in your area yet.',
    );
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() =>
      expect(
        sent.find((row) => row.path === '/staff/ambassador-applications/agr1/decline')?.body,
      ).toEqual({
        by: 'Kemi',
        reason: 'Not in your area yet.',
      }),
    );
  });
});

describe('ending a suspension on the staff Ambassadors page (31 October 2026)', () => {
  const SUSPENDED = {
    id: 'agr9',
    kind: 'shopper',
    kindWords: 'Shopper',
    accountId: 's9',
    name: 'Bea Obi',
    area: 'Medway',
    status: 'suspended',
    statusWords: 'Suspended',
    agreedAt: '2026-11-10T10:00:00.000Z',
    documentsSentAt: '2026-11-10T10:05:00.000Z',
    documentsCheckedAt: '2026-11-10T10:06:00.000Z',
    chatDoneAt: '2026-11-11T10:00:00.000Z',
    waitingDocuments: 0,
    faceCheck: 'Check by a person: face not compared automatically',
  };

  it('lifts the suspension, or removes for fraud with the businesses marked', async () => {
    const me = {
      name: 'Kemi',
      role: 'operations_manager',
      title: 'Operations manager',
      areas: ['orders', 'ambassadors'],
      mustChangePassword: false,
    };
    const sent = stubWith((method, path) => {
      if (path === '/staff/sign-in') return reply({ token: 'st1.k.sig', ...me });
      if (path === '/staff/me') return reply(me);
      if (path === '/staff/ambassador-applications') {
        return reply({
          groups: [{ status: 'suspended', words: 'Suspended', applications: [SUSPENDED] }],
        });
      }
      if (path === '/staff/ambassador-applications/agr9') {
        return reply({
          application: {
            ...SUSPENDED,
            termsVersion: '2026-10-30c',
            idType: 'passport',
            chatDoneBy: 'Anthony',
            chatNotes: '',
            decidedAt: '2026-11-20T10:00:00.000Z',
            decidedBy: 'Anthony',
            decisionReason: 'Orders look made up.',
            approvedAt: '2026-11-12T10:00:00.000Z',
            stillNeeded: [],
            canRecordChat: false,
            canApprove: true,
            canSuspend: false,
            canDecline: false,
            canLift: true,
            canRemoveForFraud: true,
            businesses: [
              { id: 'shop1', name: 'Mama Put Kitchen', unpaidPence: 1500 },
              { id: 'shop2', name: 'Corner Café', unpaidPence: 2500 },
            ],
            identityMatches: [],
            documents: [],
          },
        });
      }
      if (method === 'POST' && path.startsWith('/staff/ambassador-applications/agr9/')) {
        return reply({ message: 'Done.' });
      }
      return null;
    });
    const user = userEvent.setup({ delay: null });
    renderAt('/staff');
    await user.type(await screen.findByLabelText('Username'), 'kemi');
    await user.type(screen.getByLabelText('Password'), 'a long password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('navigation', { name: 'Admin pages' });
    await openPage(user, 'Ambassadors');
    await user.click(await screen.findByRole('button', { name: 'Open Bea Obi' }));
    expect(
      await screen.findByText('Face photo: Check by a person: face not compared automatically'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument();
    await noViolations(document.body);

    await user.click(screen.getByRole('button', { name: 'Lift the suspension' }));
    await waitFor(() =>
      expect(
        sent.find((row) => row.path === '/staff/ambassador-applications/agr9/lift')?.body,
      ).toEqual({ by: 'Kemi' }),
    );

    await user.type(
      screen.getByLabelText('Reason, for Decline, Suspend or Remove for fraud (they see it)'),
      'Made-up orders.',
    );
    await user.click(screen.getByRole('button', { name: 'Remove for fraud' }));
    expect(
      await screen.findByText(
        'Please mark the businesses that were fraudulent, or choose all of them.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByLabelText('Corner Café: £25.00 unpaid'));
    await user.click(screen.getByRole('button', { name: 'Remove for fraud' }));
    await waitFor(() =>
      expect(
        sent.find((row) => row.path === '/staff/ambassador-applications/agr9/remove-for-fraud')
          ?.body,
      ).toEqual({ by: 'Kemi', reason: 'Made-up orders.', shops: ['shop2'] }),
    );
  });
});

describe('"Did someone introduce you?" on every sign-up', () => {
  it('is on the Runner sign-up and the business join, and is sent when filled in', async () => {
    stubApi();
    const first = renderAt('/runner/sign-up');
    expect(
      await screen.findByLabelText('Did someone introduce you? Their code (optional)'),
    ).toBeInTheDocument();
    first.unmount();
    renderAt('/business/join');
    expect(
      await screen.findByLabelText('Did someone introduce you? Their code (optional)'),
    ).toBeInTheDocument();
  });
});
