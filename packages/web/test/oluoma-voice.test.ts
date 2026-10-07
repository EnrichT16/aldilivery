/**
 * Ozi speaking and hearing through Oluoma Voice (ruling 53): chosen when the server hands out a
 * pass, with the phone's own speech as the fallback, taken over automatically the moment the
 * engine fails. The engine is answered by a stubbed `fetch`; the sound in and out by stand-ins,
 * because jsdom has neither Web Audio nor a microphone.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  listenOnce,
  setVoiceEngine,
  SPEAKING_RATE,
  voiceEngine,
  type ListenOptions,
  type SpeakOptions,
  type VoiceEngine,
} from '../src/voice';
import {
  oluomaVoiceEngine,
  WavStream,
  type AudioPorts,
  type OluomaSession,
  type Recording,
} from '../src/voice/oluoma-engine';

const ENGINE = 'https://voice.example.test';
const START = Date.parse('2026-10-07T10:00:00.000Z');

function pass(token = 'ovs_one', minutes = 5, from = START): OluomaSession {
  return {
    url: ENGINE,
    token,
    expiresAt: new Date(from + minutes * 60_000).toISOString(),
  };
}

/** A 16-bit mono WAV, header and all, as the engine streams it. */
function wav(samples: number[], rate = 24_000): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string): void => {
    for (let i = 0; i < value.length; i += 1) bytes[at + i] = value.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 0xffffffff, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  // Streamed, so the length is not known yet.
  view.setUint32(40, 0xffffffff, true);
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, sample, true));
  return bytes;
}

/** Split awkwardly: through the header, and through the middle of a sample. */
function streamOf(bytes: Uint8Array, cuts = [7, 30, 47]): ReadableStream<Uint8Array> {
  const pieces: Uint8Array[] = [];
  let from = 0;
  for (const cut of [...cuts, bytes.length]) {
    pieces.push(bytes.slice(from, cut));
    from = cut;
  }
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(piece);
      controller.close();
    },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Sent {
  url: string;
  method: string;
  authorization: string | undefined;
  contentType: string | undefined;
  body: unknown;
}

/** The engine, answered by path. `answer` may return a reply or throw. */
function stubEngine(answer: (path: string, sent: Sent) => Response | Promise<Response>): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const body = init?.body;
      const one: Sent = {
        url: String(url),
        method: init?.method ?? 'GET',
        authorization: headers['authorization'],
        contentType: headers['content-type'],
        body: typeof body === 'string' ? JSON.parse(body) : body,
      };
      sent.push(one);
      return answer(String(url).replace(ENGINE, ''), one);
    }),
  );
  return sent;
}

interface FakeFallback extends VoiceEngine {
  spoken: Array<{ text: string; options: SpeakOptions }>;
  listened: ListenOptions[];
}

/** The phone's own speech, standing in: says everything, hears "from the phone". */
function fakeFallback(): FakeFallback {
  const engine: FakeFallback = {
    name: 'The phone’s own speech',
    wakeWordOnDevice: false,
    spoken: [],
    listened: [],
    readiness: async () => ({ canListen: true, canSpeak: true }),
    startListening(options) {
      engine.listened.push(options);
      options.onText('from the phone', true);
      options.onEnd?.();
    },
    stopListening() {},
    async speak(text, options) {
      engine.spoken.push({ text, options });
      return 'finished';
    },
    interrupt() {},
    voices: async () => [{ id: 'phone-voice', name: 'Phone', language: 'en-GB' }],
  };
  return engine;
}

interface FakeAudio extends AudioPorts {
  played: number[];
  rates: number[];
  /** What the next recording hears: a recording, nothing, or a refused microphone. */
  hears: Blob | null | Error;
  recordings: number;
  /** Hold playback open until `release` is called, to test being cut short. */
  hold: boolean;
  release: () => void;
}

function fakeAudio(): FakeAudio {
  let releaseAll: Array<() => void> = [];
  const ports: FakeAudio = {
    played: [],
    rates: [],
    hears: new Blob(['sound'], { type: 'audio/webm' }),
    recordings: 0,
    hold: false,
    release: () => {
      for (const release of releaseAll) release();
      releaseAll = [];
    },
    player(rate) {
      ports.rates.push(rate);
      let stopped = false;
      return {
        play(samples) {
          for (const sample of samples) ports.played.push(Math.round(sample * 32768));
        },
        finished: () =>
          ports.hold
            ? new Promise<boolean>((resolve) => releaseAll.push(() => resolve(!stopped)))
            : Promise.resolve(true),
        stop() {
          stopped = true;
        },
      };
    },
    canRecord: () => true,
    record(): Recording {
      ports.recordings += 1;
      const heard = ports.hears;
      return {
        audio: heard instanceof Error ? Promise.reject(heard) : Promise.resolve(heard),
        stop() {},
      };
    },
  };
  return ports;
}

function build(
  options: {
    session?: () => Promise<OluomaSession | null>;
    now?: () => number;
  } = {},
) {
  const fallback = fakeFallback();
  const audio = fakeAudio();
  const session = vi.fn(options.session ?? (async () => pass()));
  const engine = oluomaVoiceEngine({
    fallback,
    session,
    audio,
    now: options.now ?? (() => START),
  });
  return { engine, fallback, audio, session };
}

describe('choosing the engine', () => {
  it('uses the phone’s own speech when the server has no voice pass to give', async () => {
    const sent = stubEngine(() => json({}, 500));
    const { engine, fallback } = build({ session: async () => null });

    expect(await engine.speak('Hello.', { language: 'en-GB' })).toBe('finished');
    expect(fallback.spoken.map((s) => s.text)).toEqual(['Hello.']);
    expect(await listenOnce(engine, 'en-GB')).toBe('from the phone');
    expect(engine.name).toBe(fallback.name);
    expect(sent).toEqual([]);
  });

  it('is Oluoma Voice by default when /voice/session says it is switched on', async () => {
    const sent = stubEngine((path) => {
      if (path.endsWith('/voice/session')) {
        return json({ enabled: true, ...pass('ovs_from_our_server') });
      }
      if (path.startsWith('/v1/languages')) {
        return json({ languages: [{ language: 'en-GB', canListen: true, canSpeak: true }] });
      }
      return json({}, 404);
    });
    setVoiceEngine(null);
    const engine = voiceEngine();

    const ready = await engine.readiness('en-GB');
    expect(ready.canSpeak).toBe(true);
    expect(engine.name).toMatch(/Oluoma Voice/);
    const asked = sent.find((s) => s.url.startsWith(`${ENGINE}/v1/languages`));
    expect(asked?.url).toBe(`${ENGINE}/v1/languages?language=en-GB`);
    expect(asked?.authorization).toBe('Bearer ovs_from_our_server');
  });

  it('is the phone’s own speech by default when /voice/session says it is not', async () => {
    const sent = stubEngine((path) =>
      path.endsWith('/voice/session') ? json({ enabled: false }) : json({}, 404),
    );
    setVoiceEngine(null);
    const engine = voiceEngine();
    await engine.readiness('en-GB');
    expect(engine.name).toBe('The phone’s own speech');
    expect(sent.every((s) => !s.url.startsWith(ENGINE))).toBe(true);
  });
});

describe('speaking through Oluoma Voice', () => {
  it('asks for WAV at Ozi’s usual pace, and plays it as it arrives', async () => {
    const samples = [0, 1000, -1000, 32767, -32768, 12345, -54];
    const sent = stubEngine(
      () =>
        new Response(streamOf(wav(samples, 22_050)), {
          headers: { 'content-type': 'audio/wav', 'x-sample-rate': '22050' },
        }),
    );
    const { engine, audio, fallback } = build();

    const outcome = await engine.speak('Your shopping is on its way.', {
      language: 'en-GB',
      voiceId: 'ozi',
    });

    expect(outcome).toBe('finished');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      url: `${ENGINE}/v1/speak`,
      method: 'POST',
      authorization: 'Bearer ovs_one',
      body: {
        text: 'Your shopping is on its way.',
        voice: 'ozi',
        language: 'en-GB',
        speed: SPEAKING_RATE,
        format: 'wav',
      },
    });
    expect(audio.played).toEqual(samples);
    expect(audio.rates).toEqual([22_050]);
    expect(fallback.spoken).toEqual([]);
  });

  it('uses the engine’s own voice when the one chosen was the phone’s', async () => {
    const sent = stubEngine((_path, one) => {
      const asked = one.body as { voice?: string };
      return asked.voice
        ? json({ error: { kind: 'voice-not-found', message: 'No such voice.' } }, 404)
        : new Response(streamOf(wav([5, 6])));
    });
    const { engine, audio } = build();

    expect(await engine.speak('Hello.', { language: 'en-GB', voiceId: 'phone-voice' })).toBe(
      'finished',
    );
    expect(sent.map((s) => (s.body as { voice?: string }).voice)).toEqual([
      'phone-voice',
      undefined,
    ]);
    expect(audio.played).toEqual([5, 6]);
  });

  it('can be cut short', async () => {
    stubEngine(() => new Response(streamOf(wav([1, 2, 3]))));
    const { engine, audio } = build();
    audio.hold = true;

    const speaking = engine.speak('A long sentence.', { language: 'en-GB' });
    await vi.waitFor(() => expect(audio.played).toEqual([1, 2, 3]));
    engine.interrupt();
    expect(await speaking).toBe('interrupted');
    audio.release();
  });

  it('hands over to the phone’s own speech the moment the engine fails, and stays there', async () => {
    const sent = stubEngine(() => json({ error: { kind: 'unavailable', message: 'Down.' } }, 503));
    const { engine, fallback } = build();

    expect(await engine.speak('First.', { language: 'en-GB' })).toBe('finished');
    expect(fallback.spoken.map((s) => s.text)).toEqual(['First.']);
    expect(engine.name).toBe(fallback.name);

    expect(await engine.speak('Second.', { language: 'en-GB' })).toBe('finished');
    expect(fallback.spoken.map((s) => s.text)).toEqual(['First.', 'Second.']);
    // The engine was asked once; after it failed, nothing more went to it.
    expect(sent).toHaveLength(1);
  });

  it('hands over when the engine cannot be reached at all', async () => {
    stubEngine(() => {
      throw new TypeError('Failed to fetch');
    });
    const { engine, fallback } = build();
    expect(await engine.speak('Hello.', { language: 'en-GB' })).toBe('finished');
    expect(fallback.spoken.map((s) => s.text)).toEqual(['Hello.']);
  });

  it('fetches a new pass before the old one runs out', async () => {
    let clock = START;
    let issued = 0;
    const sent = stubEngine(() => new Response(streamOf(wav([1]))));
    const { engine, session } = build({
      now: () => clock,
      session: async () => {
        issued += 1;
        return pass(`ovs_${issued}`, 5, clock);
      },
    });

    await engine.speak('One.', { language: 'en-GB' });
    clock += 2 * 60_000;
    await engine.speak('Two.', { language: 'en-GB' });
    clock += 3 * 60_000;
    await engine.speak('Three.', { language: 'en-GB' });

    expect(session).toHaveBeenCalledTimes(2);
    expect(sent.map((s) => s.authorization)).toEqual([
      'Bearer ovs_1',
      'Bearer ovs_1',
      'Bearer ovs_2',
    ]);
  });
});

describe('hearing through Oluoma Voice', () => {
  it('sends the recording to be written down, in the Shopper’s language', async () => {
    const recorded = new Blob(['sound'], { type: 'audio/webm' });
    const sent = stubEngine(() => json({ text: ' Two pints of milk, please. ', language: 'en' }));
    const { engine, audio, fallback } = build();
    audio.hears = recorded;

    expect(await listenOnce(engine, 'en-GB')).toBe('Two pints of milk, please.');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      url: `${ENGINE}/v1/transcribe?language=en-GB`,
      method: 'POST',
      authorization: 'Bearer ovs_one',
      contentType: 'audio/webm',
      body: recorded,
    });
    expect(fallback.listened).toEqual([]);
  });

  it('says nothing was heard when nothing was said', async () => {
    const sent = stubEngine(() => json({ text: '' }));
    const { engine, audio } = build();
    audio.hears = null;
    expect(await listenOnce(engine, 'en-GB')).toBe('');
    expect(sent).toEqual([]);
  });

  it('reports a refused microphone as it is, without blaming the engine', async () => {
    stubEngine(() => json({ text: 'never' }));
    const { engine, audio, fallback } = build();
    audio.hears = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });

    await expect(listenOnce(engine, 'en-GB')).rejects.toMatchObject({ kind: 'not-allowed' });
    expect(fallback.listened).toEqual([]);
    expect(engine.name).toMatch(/Oluoma Voice/);
  });

  it('hands over to the phone’s own listening when the engine fails', async () => {
    stubEngine(() => json({ error: { kind: 'unavailable', message: 'Down.' } }, 503));
    const { engine, audio, fallback } = build();

    expect(await listenOnce(engine, 'en-GB')).toBe('from the phone');
    expect(fallback.listened).toHaveLength(1);
    // And from then on, without recording at all.
    expect(await listenOnce(engine, 'en-GB')).toBe('from the phone');
    expect(audio.recordings).toBe(1);
  });
});

describe('readiness and voices', () => {
  it('come from the engine while it is in use', async () => {
    stubEngine((path) =>
      path.startsWith('/v1/voices')
        ? json({ voices: [{ id: 'ozi', name: 'Ozi', language: 'en-GB', licence: 'Apache-2.0' }] })
        : json({
            languages: [
              { language: 'ig-NG', canListen: false, canSpeak: false, reason: 'Not yet.' },
            ],
          }),
    );
    const { engine } = build();
    expect(await engine.voices('en-GB')).toEqual([{ id: 'ozi', name: 'Ozi', language: 'en-GB' }]);
    expect(await engine.readiness('ig-NG')).toEqual({
      canListen: false,
      canSpeak: false,
      reason: 'Not yet.',
    });
  });

  it('come from the phone once the engine has failed', async () => {
    stubEngine(() => json({}, 500));
    const { engine } = build();
    expect(await engine.readiness('en-GB')).toEqual({ canListen: true, canSpeak: true });
    expect(await engine.voices('en-GB')).toEqual([
      { id: 'phone-voice', name: 'Phone', language: 'en-GB' },
    ]);
  });
});

describe('reading the engine’s WAV as it streams', () => {
  it('finds the sound after the header, however the pieces fall', () => {
    const bytes = wav([100, -100, 2000], 16_000);
    for (let cut = 1; cut < bytes.length; cut += 1) {
      const reader = new WavStream();
      const heard = [...reader.push(bytes.slice(0, cut)), ...reader.push(bytes.slice(cut))].map(
        (sample) => Math.round(sample * 32768),
      );
      expect(heard).toEqual([100, -100, 2000]);
      expect(reader.sampleRate).toBe(16_000);
    }
  });

  it('refuses something that is not a WAV file', () => {
    expect(() =>
      new WavStream().push(new TextEncoder().encode('<html>not sound</html>')),
    ).toThrow();
  });
});
