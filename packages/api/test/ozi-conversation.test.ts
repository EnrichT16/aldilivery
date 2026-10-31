/**
 * Ozi's conversations (Anthony, 31 October 2026, ruling 83): Ozi knows who is speaking from the
 * sign-in, never from the request; follows the thread; the owner talks to the larger model with
 * his desk tools, and a decision is carried out only on his clear yes in the next turn, through
 * the same desk as the keypad; every exchange is remembered with the model and who spoke; the
 * daily limit; and the weekly self-review, which only ever suggests. Stand-in brains throughout.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type {
  OwnerTalkInput,
  OziBrain,
  Understanding,
  UnderstandInput,
} from '../src/lib/language-model.js';
import { isClearYes, SIMPLER_TODAY } from '../src/lib/ozi-conversation.js';
import { trainingLine } from '../src/lib/ozi-memory.js';
import { askOwner } from '../src/services/owner-desk.js';
import { reviewOziWeek } from '../src/services/ozi-review.js';
import { buildTestApp, seedCatalogue, signUpShopper, STAFF, type TestHarness } from './helpers.js';

const START = new Date('2026-10-31T10:00:00.000Z');

let harness: TestHarness;

afterEach(async () => {
  await harness.close();
});

/** A stand-in brain that remembers what it was given. */
function standIn(
  answer: (input: UnderstandInput) => Understanding | null = () => ({
    kind: 'question',
    items: [],
    reply: 'Happy to help.',
  }),
) {
  const heard: UnderstandInput[] = [];
  const owner: OwnerTalkInput[] = [];
  const brain: OziBrain = {
    name: 'model',
    model: 'stand-in-everyday',
    ownerModel: 'stand-in-owner',
    async understand(input) {
      heard.push(input);
      return answer(input);
    },
    async talkWithOwner(input) {
      owner.push(input);
      if (/approve/i.test(input.text)) {
        const { matters } = (await input.tools.needsYou()) as { matters: Array<{ id: string }> };
        const checked = await input.tools.propose(matters[0]!.id, 'approve');
        if (!checked.ok) return { reply: checked.why, proposal: null };
        return {
          reply: checked.readBack,
          proposal: { matterId: matters[0]!.id, choice: 'approve', readBack: checked.readBack },
        };
      }
      return { reply: 'Good morning, Mr. Anthony. Two things need you today.', proposal: null };
    },
    async suggestReply({ heard: words }) {
      return /moon/.test(words) ? 'We only deliver here on Earth, I am afraid.' : null;
    },
  };
  return { brain, heard, owner };
}

async function build(brain: OziBrain) {
  harness = await buildTestApp(START, { brain, sendText: async () => undefined });
  await seedCatalogue(harness.repository);
}

function ask(
  text: string,
  headers: Record<string, string> = {},
  conversation = 'visit:one',
  extra: object = {},
) {
  return harness.app.inject({
    method: 'POST',
    url: '/ozi/reply',
    headers,
    payload: { text, mode: 'within', turn: 0, conversation, ...extra },
  });
}

async function ownerHeaders(): Promise<Record<string, string>> {
  const post = (url: string, payload: object) =>
    harness.app.inject({ method: 'POST', url, payload, headers: STAFF });
  await post('/staff/owner', {
    name: 'Anthony',
    username: 'anthony',
    password: 'a long password',
    passcode: '123456#',
  });
  const signedIn = await post('/staff/sign-in', {
    username: 'anthony',
    password: 'a long password',
    passcode: '123456#',
  });
  expect(signedIn.statusCode, signedIn.body).toBe(200);
  return { 'x-staff-token': signedIn.json().token as string };
}

/** Lets the memory writes, which never hold up a reply, land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('who is speaking', () => {
  it('comes from the sign-in: a Shopper by first name, a visitor otherwise; the body is ignored', async () => {
    const { brain, heard } = standIn();
    await build(brain);
    const shopper = await signUpShopper(harness, { displayName: 'Margaret Ade' });
    await ask('can you tell me about plans', shopper.authHeader);
    await ask('can you tell me about plans', {}, 'visit:two', { account: 'owner', who: 'owner' });
    expect(heard.map((input) => input.who)).toEqual([
      { kind: 'shopper', firstName: 'Margaret' },
      { kind: 'visitor', firstName: null },
    ]);
  });

  it('remembers the exact model and who spoke, and both go into the training export', async () => {
    const { brain } = standIn();
    await build(brain);
    const shopper = await signUpShopper(harness, { displayName: 'Margaret Ade' });
    await ask('can you tell me about plans', shopper.authHeader);
    await settle();
    const [row] = await harness.repository.memory.list({ limit: 5 });
    expect(row).toMatchObject({
      brain: 'model',
      model: 'stand-in-everyday',
      accountKind: 'shopper',
    });
    expect(JSON.parse(trainingLine(row!))).toMatchObject({
      model: 'stand-in-everyday',
      accountKind: 'shopper',
    });
  });

  it('follows the thread: the conversation so far goes with the next turn', async () => {
    const { brain, heard } = standIn();
    await build(brain);
    await ask('is the bread fresh');
    await settle();
    await ask('and the milk');
    expect(heard[1]!.history).toEqual([{ heard: 'is the bread fresh', said: 'Happy to help.' }]);
    // Another visit's thread is its own.
    await ask('what was the name of that again', {}, 'visit:other');
    expect(heard[2]!.history).toEqual([]);
  });

  it('keeps the phrase book first only for a known phrase; anything open goes to the model', async () => {
    const { brain, heard } = standIn();
    await build(brain);
    expect((await ask('how are you')).json().reply).toMatch(/very well/);
    expect(heard).toHaveLength(0);
    await ask("I'm worried my shopping won't come today");
    expect(heard).toHaveLength(1);
  });
});

describe('the owner by voice', () => {
  it('talks to the owner on his own model, never offering him an account', async () => {
    const { brain, heard, owner } = standIn();
    await build(brain);
    const headers = await ownerHeaders();
    const hello = await ask(
      'Hello Ozi, this is your owner and founder, Mr. Anthony',
      headers,
      'visit:owner',
    );
    expect(hello.json().reply).toBe('Good morning, Mr. Anthony. Two things need you today.');
    expect(heard).toHaveLength(0);
    expect(owner).toHaveLength(1);
    await settle();
    const [row] = await harness.repository.memory.list({ limit: 5 });
    expect(row).toMatchObject({ account: 'owner', accountKind: 'owner', model: 'stand-in-owner' });
  });

  it('reads a decision back, and does it only on his clear yes in the next turn, as his, by voice', async () => {
    const { brain } = standIn();
    await build(brain);
    const headers = await ownerHeaders();
    const matter = await askOwner(harness.app.ctx, {
      kind: 'organisation_enquiry',
      subjectId: 'enquiry-1',
      summary: 'A care home in Chatham would like to work with us.',
      options: 'decide',
    });
    const asked = await ask('approve the care home', headers, 'visit:owner');
    expect(asked.json()).toEqual({
      reply:
        'To be sure, Mr. Anthony: I will approve this. A care home in Chatham would like to work with us. Shall I go ahead? Say yes, or no.',
      awaitingYes: true,
    });
    // Nothing done yet.
    expect((await harness.repository.ownerDesk.findMatter(matter!.id))?.status).toBe('open');

    const yes = await ask('yes', headers, 'visit:owner');
    expect(yes.json().reply).toBe('Approved.');
    const decided = await harness.repository.ownerDesk.findMatter(matter!.id);
    expect(decided).toMatchObject({
      status: 'decided',
      decision: 'approve',
      decidedVia: 'voice',
      decidedBy: 'Mr. Anthony',
    });
    const audit = await harness.repository.audit.list({ search: 'owner-desk.decided' });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorName: 'Mr. Anthony', actorRole: 'owner' });
    expect(audit[0]!.detail).toMatch(/by voice/);

    // A second yes does nothing more: one decision for one yes.
    await ask('yes', headers, 'visit:owner');
    expect(await harness.repository.audit.list({ search: 'owner-desk.decided' })).toHaveLength(1);
  });

  it('anything but a clear yes, and nothing is done', async () => {
    const { brain } = standIn();
    await build(brain);
    const headers = await ownerHeaders();
    const matter = await askOwner(harness.app.ctx, {
      kind: 'organisation_enquiry',
      subjectId: 'enquiry-2',
      summary: 'A charity would like to work with us.',
      options: 'decide',
    });
    await ask('approve the charity', headers, 'visit:owner');
    expect((await ask('no', headers, 'visit:owner')).json().reply).toBe(
      "All right, I haven't done it.",
    );
    await ask('approve the charity', headers, 'visit:owner');
    await ask('yes, but what about the other one?', headers, 'visit:owner');
    // A yes in another conversation is not his answer to this one.
    await ask('approve the charity', headers, 'visit:owner');
    await ask('yes', headers, 'visit:elsewhere');
    expect((await harness.repository.ownerDesk.findMatter(matter!.id))?.status).toBe('open');
  });

  it('a clear yes is only a yes', () => {
    for (const yes of ['yes', 'Yes please.', 'go ahead', 'do it', 'yes, go ahead', 'Ozi yes']) {
      expect(isClearYes(yes)).toBe(true);
    }
    for (const not of ['no', 'yes no', 'not yet', "don't", 'yes?', 'maybe', 'yes but wait', '']) {
      expect(isClearYes(not)).toBe(false);
    }
  });
});

describe('the daily limit', () => {
  it('past the most model turns a day, Ozi says so once and carries on without the model', async () => {
    const { brain, heard } = standIn();
    await build(brain);
    (harness.app.ctx.config as { ozi: { maxModelTurnsPerDay: number } }).ozi = {
      ...harness.app.ctx.config.ozi,
      maxModelTurnsPerDay: 2,
    };
    const shopper = await signUpShopper(harness, { displayName: 'Margaret Ade' });
    await ask('tell me about plans', shopper.authHeader);
    await ask('tell me about Runners', shopper.authHeader);
    const third = await ask('tell me about the weather', shopper.authHeader);
    expect(third.json().reply).toContain(SIMPLER_TODAY);
    const fourth = await ask('tell me about the moon', shopper.authHeader);
    expect(fourth.json().reply ?? '').not.toContain(SIMPLER_TODAY);
    expect(heard).toHaveLength(2);
    // Somebody else still has their own turns.
    await ask('tell me about plans', {}, 'visit:someone-else');
    expect(heard).toHaveLength(3);
  });
});

describe("Ozi's weekly self-review", () => {
  it('suggests better replies on the Learning list for a person, never applies them, and is idempotent', async () => {
    const { brain } = standIn(() => null);
    await build(brain);
    await ask('do you deliver to the moon');
    await ask('what colour is a quasar');
    await settle();
    const first = await reviewOziWeek(harness.app.ctx);
    expect(first).toEqual({ skipped: null, reviewed: 2, suggested: 1 });
    const waiting = await harness.repository.learned.list('waiting');
    const moon = waiting.find((row) => row.text === 'do you deliver to the moon');
    expect(moon).toMatchObject({
      status: 'waiting',
      reply: null,
      suggestedReply: 'We only deliver here on Earth, I am afraid.',
    });
    // Shown on the Learning list for a person to judge.
    const listed = await harness.app.inject({
      method: 'GET',
      url: '/staff/learning',
      headers: STAFF,
    });
    expect(listed.json().waiting).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ suggestedReply: 'We only deliver here on Earth, I am afraid.' }),
      ]),
    );
    // Never applied by itself: Ozi still does not answer with it.
    expect((await ask('do you deliver to the moon')).json().reply).toBeNull();
    // Running again does nothing more, today or later in the week.
    expect(await reviewOziWeek(harness.app.ctx)).toMatchObject({ skipped: 'not-due' });
    harness.setNow(new Date(START.getTime() + 8 * 24 * 3600 * 1000));
    const again = await reviewOziWeek(harness.app.ctx);
    expect(again.suggested).toBe(0);
    expect(
      (await harness.repository.learned.list('waiting')).filter((row) => row.suggestedReply),
    ).toHaveLength(1);
  });
});
