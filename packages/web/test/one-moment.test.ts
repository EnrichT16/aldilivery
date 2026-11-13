/**
 * "One moment" (31 October 2026): while the server works an answer out, Ozi's button says so,
 * and the waits are about 8 seconds, 20 for the owner (ruling 86), before Ozi goes on as before.
 * Nothing is said aloud until `ozi.fillerAfterMs` (ruling 92), and then a short varied filler,
 * never the same one twice running.
 */

import { describe, expect, it } from 'vitest';

import { presenceWord } from '../src/components/OziBubble';
import { storeConfig } from '../src/config';
import { FILLERS, forgetLastFiller, nextFiller } from '../src/voice/filler';
import { CONVERSE_WAIT_MS, OWNER_CONVERSE_WAIT_MS } from '../src/voice/phrases';

describe('One moment', () => {
  it('shows on the button while Ozi works an answer out, and talking still comes first', () => {
    expect(presenceWord({ talking: false, presence: 'listening', waiting: true })).toBe(
      'One moment',
    );
    expect(presenceWord({ talking: true, presence: 'listening', waiting: true })).toBe('Talking');
    expect(presenceWord({ talking: false, presence: 'listening' })).toBe('Listening');
  });

  it('waits about 8 seconds, and 50 for the owner, longer than his model is given (13 November 2026); a filler only after 6 (ruling 92)', () => {
    expect(CONVERSE_WAIT_MS).toBe(8000);
    expect(OWNER_CONVERSE_WAIT_MS).toBe(50_000);
    expect(storeConfig.ozi.fillerAfterMs).toBe(6000);
  });

  it('never says the same filler twice in a row, and none of them uses a name', () => {
    forgetLastFiller();
    let previous = nextFiller();
    for (let i = 0; i < 50; i += 1) {
      const next = nextFiller();
      expect(FILLERS).toContain(next);
      expect(next).not.toBe(previous);
      previous = next;
    }
    for (const filler of FILLERS) expect(filler).not.toMatch(/Anthony|sir/i);
  });
});
