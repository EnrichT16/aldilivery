/**
 * Which voice engine Ozi is using. One place, so swapping the stand-in for Oluoma Voice is a
 * change to this file and nothing else (docs/BUILD_PROMPT.md, Section E).
 */

import { browserVoiceEngine } from './browser-engine';
import type { VoiceEngine } from './engine';

let current: VoiceEngine | null = null;

export function voiceEngine(): VoiceEngine {
  current ??= browserVoiceEngine();
  return current;
}

/** For tests, and for the day Oluoma Voice arrives. */
export function setVoiceEngine(engine: VoiceEngine | null): void {
  current = engine;
}

export * from './engine';
