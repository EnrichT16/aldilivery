/**
 * Oluoma Voice behind Ozi's voice interface (ruling 53, docs/OLUOMA_VOICE.md).
 *
 * Ozi speaks and hears through Oluoma Voice when the server has it set up; the phone's own
 * speech remains the fallback; the engine key never leaves the server.
 *
 * The first time Ozi needs its voice, it asks our server for a pass (`GET /voice/session`).
 * The pass is the engine's address and a token that lasts five minutes; a new one is fetched
 * before it runs out. When the server has none to give, Ozi uses the phone's own speech for
 * the whole visit, exactly as before.
 *
 * Speaking sends the words to the engine and plays the sound as it arrives, so the first
 * sentence is heard before the last one is made. Listening records the microphone until the
 * Shopper stops talking, then sends the recording to be written down.
 *
 * If anything goes wrong with the engine mid-visit, Ozi goes back to the phone's own speech for
 * the rest of the visit, and the sentence or the listening that failed is handed over too, so
 * nobody is left in silence. A microphone the Shopper has refused is not the engine's fault,
 * and is reported as it is.
 */

import {
  SPEAKING_RATE,
  microphoneAlreadyAllowed,
  type LanguageTag,
  type ListenOptions,
  type OutputVoice,
  type SpeakOptions,
  type SpeakOutcome,
  type VoiceEngine,
  type VoiceReadiness,
} from './engine';

/** A pass to the engine, from our own server. */
export interface OluomaSession {
  url: string;
  token: string;
  /** When the token stops working, as an ISO date. */
  expiresAt: string;
}

/** Plays sound as it arrives, one piece straight after another. */
export interface SoundPlayer {
  /** Queue samples, from -1 to 1, to be played after whatever is already queued. */
  play(samples: Float32Array): void;
  /** Once everything queued has played: true if it was heard, false if it never could be. */
  finished(): Promise<boolean>;
  /** Stop now, mid-word if need be. */
  stop(): void;
}

/** One go at recording the microphone. */
export interface Recording {
  /**
   * The recording, once the Shopper has stopped talking or `stop` was called; null when
   * nothing was said. Rejects when the microphone cannot be used.
   */
  audio: Promise<Blob | null>;
  stop(): void;
}

/** Sound in and out: the browser's own, or a test's. */
export interface AudioPorts {
  player(sampleRate: number): SoundPlayer;
  canRecord(): boolean;
  record(): Recording;
}

/** The engine's sound: 24,000 samples a second, unless it says otherwise. */
const DEFAULT_SAMPLE_RATE = 24_000;
/** A pass is renewed when it has less than this left, so no request carries a dying token. */
const RENEW_BEFORE_MS = 30_000;
/** How long Ozi waits to hear whether Oluoma Voice is there before using the phone's speech. */
const DECIDE_WAIT_MS = 3000;

class EngineFailure extends Error {
  constructor(
    readonly kind: string,
    message: string,
  ) {
    super(message);
    this.name = 'EngineFailure';
  }
}

/**
 * Turns a WAV file arriving in pieces into samples. The engine sends 16-bit mono sound; the
 * header says how fast, and the length in it is not to be trusted while it streams.
 */
export class WavStream {
  sampleRate = DEFAULT_SAMPLE_RATE;
  private header: Uint8Array | null = new Uint8Array(0);
  private carry: Uint8Array | null = null;

  /** The samples in this piece, from -1 to 1. Empty until the header has passed. */
  push(chunk: Uint8Array): Float32Array {
    let bytes = chunk;
    if (this.header) {
      const joined = new Uint8Array(this.header.length + chunk.length);
      joined.set(this.header);
      joined.set(chunk, this.header.length);
      const start = this.findData(joined);
      if (start === null) {
        this.header = joined;
        return new Float32Array(0);
      }
      this.header = null;
      bytes = joined.subarray(start);
    }
    if (this.carry) {
      const joined = new Uint8Array(this.carry.length + bytes.length);
      joined.set(this.carry);
      joined.set(bytes, this.carry.length);
      bytes = joined;
      this.carry = null;
    }
    // Two bytes to a sample: an odd one left over waits for the next piece.
    const even = bytes.length - (bytes.length % 2);
    if (even < bytes.length) this.carry = bytes.slice(even);
    const view = new DataView(bytes.buffer, bytes.byteOffset, even);
    const samples = new Float32Array(even / 2);
    for (let i = 0; i < samples.length; i += 1) samples[i] = view.getInt16(i * 2, true) / 32768;
    return samples;
  }

  /** Where the sound starts, once the whole header is here; null until then. */
  private findData(bytes: Uint8Array): number | null {
    if (bytes.length < 12) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    const tag = (at: number): string => String.fromCharCode(...bytes.subarray(at, at + 4));
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
      throw new EngineFailure('bad-audio', 'The voice engine did not send a WAV file.');
    }
    let at = 12;
    while (at + 8 <= bytes.length) {
      const id = tag(at);
      const size = view.getUint32(at + 4, true);
      if (id === 'data') return at + 8;
      if (at + 8 + size > bytes.length) return null;
      if (id === 'fmt ') {
        const channels = view.getUint16(at + 10, true);
        const bits = view.getUint16(at + 22, true);
        if (channels !== 1 || bits !== 16) {
          throw new EngineFailure('bad-audio', 'The voice engine sent sound Ozi cannot play.');
        }
        this.sampleRate = view.getUint32(at + 12, true);
      }
      // Chunks are padded to an even length.
      at += 8 + size + (size % 2);
    }
    return null;
  }
}

let sharedContext: AudioContext | null = null;

function audioContext(): AudioContext {
  sharedContext ??= new AudioContext();
  // Browsers start sound suspended until the page has been touched; ask it to start now.
  if (sharedContext.state === 'suspended') void sharedContext.resume().catch(() => undefined);
  return sharedContext;
}

/** The browser's own sound: Web Audio to play, MediaRecorder to record. */
export function browserAudio(): AudioPorts {
  return {
    player(sampleRate) {
      const context = audioContext();
      const sources: AudioBufferSourceNode[] = [];
      let endsAt = 0;
      let stopped = false;
      return {
        play(samples) {
          if (stopped || samples.length === 0) return;
          const buffer = context.createBuffer(1, samples.length, sampleRate);
          buffer.getChannelData(0).set(samples);
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(context.destination);
          // Straight after the last piece, so there is no gap and no overlap.
          const at = Math.max(context.currentTime + 0.05, endsAt);
          source.start(at);
          endsAt = at + buffer.duration;
          sources.push(source);
        },
        finished() {
          const last = sources[sources.length - 1];
          if (!last || stopped) return Promise.resolve(!stopped);
          return new Promise<boolean>((resolve) => {
            // A page that has not been touched yet cannot make a sound, and the last piece
            // never ends. The wait is sized to the sound, so it cannot hang on that.
            const left = Math.max(0, endsAt - context.currentTime);
            const safety = window.setTimeout(() => resolve(false), left * 1000 + 2000);
            last.onended = () => {
              window.clearTimeout(safety);
              resolve(!stopped);
            };
          });
        },
        stop() {
          stopped = true;
          for (const source of sources) {
            try {
              source.stop();
            } catch {
              // Not started yet, or already finished.
            }
          }
        },
      };
    },

    canRecord() {
      return (
        typeof MediaRecorder !== 'undefined' &&
        typeof AudioContext !== 'undefined' &&
        typeof navigator !== 'undefined' &&
        typeof navigator.mediaDevices?.getUserMedia === 'function'
      );
    },

    record() {
      let stopNow = (): void => {
        stopEarly = true;
      };
      let stopEarly = false;
      const audio = (async (): Promise<Blob | null> => {
        // Both asked for before anything is awaited, so a tap counts for them (ruling 62): the
        // sound, which a browser keeps paused until a touch, and the microphone.
        const context = audioContext();
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        const recorder = new MediaRecorder(stream);
        const pieces: Blob[] = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) pieces.push(event.data);
        };
        // How loud the microphone is, to tell when the Shopper starts and stops talking.
        const input = context.createMediaStreamSource(stream);
        const meter = context.createAnalyser();
        meter.fftSize = 1024;
        input.connect(meter);
        const levels = new Float32Array(meter.fftSize);

        return new Promise<Blob | null>((resolve) => {
          const startedAt = Date.now();
          let talked = false;
          let stoppedByHand = false;
          let quietSince = startedAt;
          const finish = (): void => {
            if (recorder.state !== 'inactive') recorder.stop();
          };
          const timer = window.setInterval(() => {
            meter.getFloatTimeDomainData(levels);
            let sum = 0;
            for (const level of levels) sum += level * level;
            const now = Date.now();
            if (Math.sqrt(sum / levels.length) > 0.02) {
              talked = true;
              quietSince = now;
            }
            // A second of quiet after talking ends it, as does eight seconds of nothing, or
            // half a minute in all.
            if (talked && now - quietSince > 1000) finish();
            if (!talked && now - startedAt > 8000) finish();
            if (now - startedAt > 30_000) finish();
          }, 100);
          recorder.onstop = () => {
            window.clearInterval(timer);
            input.disconnect();
            for (const track of stream.getTracks()) track.stop();
            // Stopped by hand, it is sent whatever the meter thought: the engine can tell
            // quiet speech from silence better than a level can.
            const keep = (talked || stoppedByHand) && pieces.length > 0;
            resolve(keep ? new Blob(pieces, { type: recorder.mimeType }) : null);
          };
          stopNow = () => {
            stoppedByHand = true;
            finish();
          };
          recorder.start(250);
          if (stopEarly) stopNow();
        });
      })();
      return { audio, stop: () => stopNow() };
    },
  };
}

function isRefusedMicrophone(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === 'NotAllowedError' || name === 'SecurityError';
}

export function oluomaVoiceEngine(options: {
  /** The phone's own speech, used when Oluoma Voice is not there or fails. */
  fallback: VoiceEngine;
  /** A fresh pass from our server, or null when Oluoma Voice is not set up. */
  session: () => Promise<OluomaSession | null>;
  audio?: AudioPorts;
  now?: () => number;
}): VoiceEngine {
  const { fallback, session } = options;
  const audio = options.audio ?? browserAudio();
  const now = options.now ?? (() => Date.now());

  let pass: OluomaSession | null = null;
  let decided: Promise<boolean> | null = null;
  /** The choice, once made, so listening can start without waiting on anything. */
  let decision: boolean | null = null;
  let inUse = false;
  let speech: { abort: AbortController; settle: (outcome: SpeakOutcome) => void } | null = null;
  let player: SoundPlayer | null = null;
  /** The listening under way. Cancelled when another starts, so only the latest is answered. */
  let listening: { recording: Recording | null; cancelled: boolean } | null = null;

  /** Back to the phone's own speech, for the rest of the visit. */
  function giveUp(): void {
    inUse = false;
  }

  /** Whether to use Oluoma Voice: decided once, from the first pass, then until it fails. */
  async function oluomaChosen(): Promise<boolean> {
    decided ??= new Promise<boolean>((resolve) => {
      let late = false;
      const timer = setTimeout(() => {
        late = true;
        resolve(false);
      }, DECIDE_WAIT_MS);
      session().then(
        (first) => {
          clearTimeout(timer);
          // Too late: the phone's speech has already been chosen for this visit.
          if (late) return;
          pass = first;
          inUse = first !== null;
          resolve(inUse);
        },
        () => {
          clearTimeout(timer);
          resolve(false);
        },
      );
    });
    const chosen = await decided;
    decision = chosen;
    return chosen && inUse;
  }

  async function currentPass(): Promise<OluomaSession> {
    if (pass && Date.parse(pass.expiresAt) - now() > RENEW_BEFORE_MS) return pass;
    pass = await session();
    if (!pass) throw new EngineFailure('unavailable', 'Oluoma Voice is not there any more.');
    return pass;
  }

  /** A request to the engine, with the token. Throws on anything but a good answer. */
  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const { url, token } = await currentPass();
    const response = await fetch(`${url.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      let kind = 'other';
      try {
        const body = (await response.json()) as { error?: { kind?: string } };
        kind = body.error?.kind ?? kind;
      } catch {
        // Not JSON; the status is enough.
      }
      throw new EngineFailure(kind, `Oluoma Voice answered ${response.status}.`);
    }
    return response;
  }

  async function speakWithOluoma(
    text: string,
    speakOptions: SpeakOptions,
    abort: AbortController,
    isCurrent: () => boolean,
  ): Promise<SpeakOutcome> {
    const ask = (voice: string | undefined): Promise<Response> =>
      call('/v1/speak', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          ...(voice ? { voice } : {}),
          language: speakOptions.language,
          speed: SPEAKING_RATE,
          format: 'wav',
        }),
        signal: abort.signal,
      });
    let response: Response;
    try {
      response = await ask(speakOptions.voiceId);
    } catch (error) {
      // A voice chosen on the phone's own speech is not one of the engine's: use its default.
      if (!(error instanceof EngineFailure && error.kind === 'voice-not-found')) throw error;
      response = await ask(undefined);
    }
    if (!response.body) throw new EngineFailure('bad-audio', 'Oluoma Voice sent no sound.');

    const wav = new WavStream();
    const told = Number(response.headers.get('x-sample-rate'));
    if (Number.isFinite(told) && told > 0) wav.sampleRate = told;
    const reader = response.body.getReader();
    let mine: SoundPlayer | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (!isCurrent()) {
        void reader.cancel().catch(() => undefined);
        return 'interrupted';
      }
      if (done) break;
      const samples = wav.push(value);
      if (samples.length === 0) continue;
      if (!mine) {
        mine = audio.player(wav.sampleRate);
        player = mine;
      }
      mine.play(samples);
    }
    if (!mine) return 'finished';
    const heard = await mine.finished();
    if (!isCurrent()) return 'interrupted';
    return heard ? 'finished' : 'not-spoken';
  }

  const engine: VoiceEngine = {
    get name(): string {
      // Honest about where the sound goes, as docs/OLUOMA_VOICE.md asks.
      return inUse ? 'Oluoma Voice, our own voice server' : fallback.name;
    },

    wakeWordOnDevice: false,

    // Both ways of listening need a tap the first time: Oluoma Voice asks the browser for the
    // microphone, and so does the phone's own speech (ruling 62).
    async firstListenNeedsTap(): Promise<boolean> {
      return !(await microphoneAlreadyAllowed());
    },

    async readiness(language: LanguageTag): Promise<VoiceReadiness> {
      if (!(await oluomaChosen())) return fallback.readiness(language);
      try {
        const response = await call(`/v1/languages?language=${encodeURIComponent(language)}`);
        const body = (await response.json()) as {
          languages?: Array<{ canListen?: boolean; canSpeak?: boolean; reason?: string | null }>;
        };
        const ready = body.languages?.[0];
        if (!ready) throw new EngineFailure('other', 'Oluoma Voice did not say.');
        // Without a way to record here, listening is the phone's own, if it has one.
        const canListen = audio.canRecord()
          ? ready.canListen === true
          : (await fallback.readiness(language)).canListen;
        return {
          canListen,
          canSpeak: ready.canSpeak === true,
          ...(ready.reason ? { reason: ready.reason } : {}),
        };
      } catch {
        giveUp();
        return fallback.readiness(language);
      }
    },

    startListening(listenOptions: ListenOptions): void {
      if (listening) {
        listening.cancelled = true;
        listening.recording?.stop();
      }
      const mine: { recording: Recording | null; cancelled: boolean } = {
        recording: null,
        cancelled: false,
      };
      listening = mine;
      const end = (): void => {
        if (listening === mine) listening = null;
        listenOptions.onEnd?.();
      };
      const handOver = (): void => {
        if (listening === mine) listening = null;
        if (!mine.cancelled) fallback.startListening(listenOptions);
        else listenOptions.onEnd?.();
      };

      const listen = async (recording: Recording): Promise<void> => {
        let heard: Blob | null;
        try {
          heard = await recording.audio;
        } catch (error) {
          if (isRefusedMicrophone(error)) {
            listenOptions.onError?.({
              kind: 'not-allowed',
              message: 'The microphone is not allowed for this site.',
            });
            end();
          } else {
            giveUp();
            handOver();
          }
          return;
        }
        if (mine.cancelled) {
          end();
          return;
        }
        if (!heard) {
          listenOptions.onError?.({ kind: 'no-speech', message: 'I did not hear anything.' });
          end();
          return;
        }
        try {
          const response = await call(
            `/v1/transcribe?language=${encodeURIComponent(listenOptions.language)}`,
            {
              method: 'POST',
              headers: { 'content-type': heard.type || 'application/octet-stream' },
              body: heard,
            },
          );
          const body = (await response.json()) as { text?: string };
          const said = (body.text ?? '').trim();
          if (!mine.cancelled) {
            if (said) listenOptions.onText(said, true);
            else
              listenOptions.onError?.({ kind: 'no-speech', message: 'I did not hear anything.' });
          }
          end();
        } catch {
          // What was said is lost with the engine; the phone listens again, so it can be said
          // once more.
          giveUp();
          handOver();
        }
      };

      /**
       * The microphone is asked for here, in the same moment, with nothing awaited first:
       * called from a tap, the browser counts it as the person's own doing and shows its own
       * "Allow microphone?" question (ruling 62). An iPhone asked any later refuses without
       * asking.
       */
      const begin = (useOluoma: boolean): void => {
        if (!useOluoma || !audio.canRecord()) {
          handOver();
          return;
        }
        if (mine.cancelled) {
          end();
          return;
        }
        const recording = audio.record();
        mine.recording = recording;
        void listen(recording);
      };

      // Once the choice is made, which it is by the time anybody taps, start at once.
      if (decision !== null) begin(decision && inUse);
      else void oluomaChosen().then(begin);
    },

    stopListening(): void {
      // What was recorded so far is still sent and written down. Stopped before recording
      // began, there is nothing to send.
      if (listening && !listening.recording) listening.cancelled = true;
      listening?.recording?.stop();
      fallback.stopListening();
    },

    async speak(text: string, speakOptions: SpeakOptions): Promise<SpeakOutcome> {
      if (text.trim() === '') return 'finished';
      if (!(await oluomaChosen())) return fallback.speak(text, speakOptions);
      // A new sentence replaces whatever was being said.
      engine.interrupt();

      const abort = new AbortController();
      return new Promise<SpeakOutcome>((resolve) => {
        const mine = {
          abort,
          settle: (outcome: SpeakOutcome) => {
            if (speech === mine) speech = null;
            resolve(outcome);
          },
        };
        speech = mine;
        const isCurrent = (): boolean => speech === mine;
        speakWithOluoma(text, speakOptions, abort, isCurrent).then(
          (outcome) => {
            if (isCurrent()) mine.settle(outcome);
          },
          () => {
            if (!isCurrent()) return;
            speech = null;
            player?.stop();
            // The engine failed: the phone says it instead, from now on.
            giveUp();
            fallback.speak(text, speakOptions).then(resolve, () => resolve('not-spoken'));
          },
        );
      });
    },

    interrupt(): void {
      const current = speech;
      speech = null;
      player?.stop();
      player = null;
      if (current) {
        current.abort.abort();
        current.settle('interrupted');
      }
      fallback.interrupt();
    },

    async voices(language: LanguageTag): Promise<OutputVoice[]> {
      if (!(await oluomaChosen())) return fallback.voices(language);
      try {
        const response = await call(`/v1/voices?language=${encodeURIComponent(language)}`);
        const body = (await response.json()) as {
          voices?: Array<{ id: string; name: string; language: string }>;
        };
        return (body.voices ?? []).map((voice) => ({
          id: voice.id,
          name: voice.name,
          language: voice.language,
        }));
      } catch {
        giveUp();
        return fallback.voices(language);
      }
    },
  };

  return engine;
}
