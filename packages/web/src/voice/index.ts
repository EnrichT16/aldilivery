/**
 * Which voice engine Ozi is using. One place, so swapping engines is a change to this file and
 * nothing else (docs/BUILD_PROMPT.md, Section E).
 *
 * Oluoma Voice when the server has it set up, and the phone's own speech otherwise, or the
 * moment Oluoma Voice fails (ruling 53). The choice is made inside `oluoma-engine.ts`, on the
 * first thing asked of the voice, so nothing waits for it before the first screen.
 */

import { fetchVoiceSession } from '../lib/api';
import { browserVoiceEngine } from './browser-engine';
import type { VoiceEngine } from './engine';
import { oluomaVoiceEngine } from './oluoma-engine';

let current: VoiceEngine | null = null;

export function voiceEngine(): VoiceEngine {
  current ??= oluomaVoiceEngine({ fallback: browserVoiceEngine(), session: fetchVoiceSession });
  return current;
}

/** For tests. */
export function setVoiceEngine(engine: VoiceEngine | null): void {
  current = engine;
}

export * from './engine';
