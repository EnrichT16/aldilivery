import { describe, expect, it } from 'vitest';

import type { FetchLike } from '../src/core/types.js';
import { buildBriefing, runBriefing } from '../src/helpers/briefing/briefing.js';
import { handleEmail } from '../src/helpers/inbox/inbox.js';
import { runWatchman } from '../src/helpers/watchman/watchman.js';
import { appHarness, email, harness, testConfig } from './support.js';

const down: FetchLike = async (input) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  return url.includes('api.')
    ? new Response('bad gateway', { status: 502 })
    : new Response('Welcome');
};

describe('the Briefing', () => {
  it('says what happened in short sentences, ready to be spoken', async () => {
    const { runtime, now } = harness({ noBrain: true, fetch: down });
    now.value = new Date('2026-10-07T06:30:00Z'); // 7:30 in the morning in London
    const inbox = runtime.helper('inbox')!;
    await inbox.teach({
      question: 'What are your opening hours?',
      answer: 'Nine till five.',
      by: 'Anthony',
    });
    await handleEmail(runtime, email());
    await handleEmail(
      runtime,
      email({ subject: 'Complaint', text: 'The order was late and cold. I want a refund.' }),
    );
    await handleEmail(
      runtime,
      email({ subject: 'Urgent', text: 'There was an accident at the door' }),
    );
    await handleEmail(
      runtime,
      email({ subject: 'SEO services', text: 'backlinks to rank your website' }),
    );
    await runWatchman(runtime);
    await runWatchman(runtime);

    const text = await buildBriefing(runtime, 'daily', runtime.helper('briefing'));
    expect(text).toBe(
      [
        'Good morning Anthony. This is your briefing for Wednesday 7 October.',
        '4 emails came in: 2 general questions and 1 complaint. 1 was spam and was set aside.',
        '1 was urgent, and you were texted.',
        '3 replies are waiting for your approval.',
        'The helpers learned 1 new answer, and no items were approved.',
        'The app server has a problem since 7:30 am: it answered with error 502.',
        'That is all. Have a good day.',
      ].join('\n'),
    );
    // Nothing a voice would stumble over.
    expect(text).not.toMatch(/https?:|@|[#*_<>{}[\]]/);
  });

  it('gives a weekly view with the share of website checks that passed', async () => {
    const { runtime } = harness({ fetch: async () => new Response('Welcome {"status":"ok"}') });
    runtime.helper('watchman')!.config.watchman!.checks = [
      { name: 'the website', url: 'https://example.com', expectText: 'Welcome' },
    ];
    await runWatchman(runtime);
    const text = await buildBriefing(runtime, 'weekly', runtime.helper('briefing'));
    expect(text).toContain(
      'This is your weekly briefing, for the seven days to Wednesday 7 October.',
    );
    expect(text).toContain('All the websites are working.');
    expect(text).toContain('Over the week, 100 percent of website checks passed.');
    expect(text).toContain('No emails came in.');
  });

  it('reads numbers from the business websites, with a token from the environment', async () => {
    const config = testConfig();
    config.helpers[2]!.briefing = {
      metrics: [
        { label: 'orders today', urlEnv: 'ORDERS_URL', tokenEnv: 'ORDERS_TOKEN' },
        { label: 'sign-ups', url: 'https://x.example/broken' },
      ],
    };
    const seen: string[] = [];
    const fetcher: FetchLike = async (input, init) => {
      const url = String(input);
      seen.push(new Headers(init?.headers).get('authorization') ?? '');
      return url.includes('broken')
        ? new Response('', { status: 500 })
        : Response.json({ count: 14 });
    };
    const { runtime } = harness({
      config,
      fetch: fetcher,
      env: { ORDERS_URL: 'https://api.example/orders/today', ORDERS_TOKEN: 'secret-token' },
    });
    const text = await buildBriefing(runtime, 'daily', runtime.helper('briefing'));
    expect(text).toContain('Orders today: 14. sign-ups: not available.');
    expect(seen[0]).toBe('Bearer secret-token');
    expect(text).not.toContain('secret-token');
  });

  it('is kept for the admin page and Oluoma Voice, and texted when asked', async () => {
    const { call, app, sms } = appHarness({
      fetch: async () => new Response('Welcome {"status":"ok"}'),
    });
    const made = (await (await call('POST', '/api/run/daily-briefing')).json()) as {
      result: string;
    };
    expect(made.result).toMatch(/^Good morning Anthony/);
    const latest = await call('GET', '/api/briefing/latest?format=text');
    expect(latest.headers.get('content-type')).toMatch(/text\/plain/);
    expect(await latest.text()).toBe(made.result);
    expect(sms.sentForReal.map((t) => t.text)).toContain(made.result); // deliver: ["text"] in the test config
    expect(await app.scheduled(new Date('2026-10-05T07:00:00Z'))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^weekly-briefing: Good morning Anthony/)]),
    );
  });

  it('runs even with no briefing helper set up', async () => {
    const config = testConfig();
    config.helpers = config.helpers.slice(0, 1);
    const { runtime } = harness({ config });
    expect(await runBriefing(runtime, 'daily')).toMatch(/No emails came in/);
  });
});
