/**
 * Smooth speech (ruling 92, 3 November 2026): the sentences of one reply are queued on the
 * phone's synthesiser, each spoken after the one before with no cancel between them (the click
 * the founder heard), while a new reply or a person speaking over Ozi still stops everything at
 * once. Also the reading of a streamed reply's events.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readEvents } from '../src/lib/api';
import { browserVoiceEngine } from '../src/voice/browser-engine';

interface FakeUtterance {
  text: string;
  lang: string;
  rate: number;
  voice: unknown;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}

/** A synthesiser under the test's control: it records speaks and cancels, and ends on command. */
function fakeSynthesis() {
  const spoken: FakeUtterance[] = [];
  const cancel = vi.fn(() => {
    // As a real synthesiser does: everything queued is dropped with "interrupted".
    const dropped = spoken.splice(0, spoken.length);
    for (const one of dropped) one.onerror?.({ error: 'interrupted' });
  });
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      lang = '';
      rate = 0;
      voice: unknown = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      constructor(readonly text: string) {}
    },
  );
  vi.stubGlobal('speechSynthesis', {
    getVoices: () => [{ voiceURI: 'gb', name: 'British', lang: 'en-GB', default: true }],
    speak: (utterance: FakeUtterance) => {
      spoken.push(utterance);
    },
    cancel,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  return {
    spoken,
    cancel,
    /** The synthesiser finishes the sentence at the front of its queue. */
    finishNext() {
      const next = spoken.shift();
      next?.onend?.();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('queued speech (ruling 92)', () => {
  it('speaks the sentences of one reply back to back, with no cancel between them', async () => {
    const synth = fakeSynthesis();
    const engine = browserVoiceEngine();
    const first = engine.speak('Two things need you.', { language: 'en-GB' });
    await vi.waitFor(() => expect(synth.spoken).toHaveLength(1));
    const second = engine.speak('The first is a new shop.', { language: 'en-GB', queue: true });
    const third = engine.speak('Shall I go on?', { language: 'en-GB', queue: true });
    await vi.waitFor(() => expect(synth.spoken).toHaveLength(3));
    // The first sentence started with a cancel of whatever was before; the queued ones did not.
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(synth.spoken.map((one) => one.text)).toEqual([
      'Two things need you.',
      'The first is a new shop.',
      'Shall I go on?',
    ]);
    synth.finishNext();
    await expect(first).resolves.toBe('finished');
    synth.finishNext();
    await expect(second).resolves.toBe('finished');
    synth.finishNext();
    await expect(third).resolves.toBe('finished');
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });

  it('a new reply still replaces what was being said, and barge-in stops everything at once', async () => {
    const synth = fakeSynthesis();
    const engine = browserVoiceEngine();
    const first = engine.speak('One.', { language: 'en-GB' });
    const second = engine.speak('Two.', { language: 'en-GB', queue: true });
    await vi.waitFor(() => expect(synth.spoken).toHaveLength(2));
    // Somebody speaks over Ozi: the queue is cut at once.
    engine.interrupt();
    await expect(first).resolves.toBe('interrupted');
    await expect(second).resolves.toBe('interrupted');
    expect(synth.cancel).toHaveBeenCalledTimes(2);

    const third = engine.speak('Three.', { language: 'en-GB', queue: true });
    await vi.waitFor(() => expect(synth.spoken).toHaveLength(1));
    // A reply that is not queued replaces the one being said.
    const fourth = engine.speak('Four.', { language: 'en-GB' });
    await expect(third).resolves.toBe('interrupted');
    await vi.waitFor(() => expect(synth.spoken.map((one) => one.text)).toEqual(['Four.']));
    synth.finishNext();
    await expect(fourth).resolves.toBe('finished');
  });
});

describe('reading a streamed reply (ruling 92)', () => {
  it('gives each complete event, keeps a part event for the next read, and skips a broken one', () => {
    const first = readEvents('data: {"type":"sentence","text":"Hello."}\n\ndata: {"ty');
    expect(first.events).toEqual([{ type: 'sentence', text: 'Hello.' }]);
    expect(first.rest).toBe('data: {"ty');
    const second = readEvents(
      `${first.rest}pe":"done","reply":"Hello.","unsaid":""}\n\ndata: nonsense\n\n`,
    );
    expect(second.events).toEqual([{ type: 'done', reply: 'Hello.', unsaid: '' }]);
    expect(second.rest).toBe('');
  });
});
