/**
 * "One moment" (31 October 2026): while the server works an answer out, Ozi's button says so,
 * and the waits are about 8 seconds, 12 for the owner, before Ozi goes on as before.
 */

import { describe, expect, it } from 'vitest';

import { presenceWord } from '../src/components/OziBubble';
import { CONVERSE_WAIT_MS, OWNER_CONVERSE_WAIT_MS } from '../src/voice/phrases';

describe('One moment', () => {
  it('shows on the button while Ozi works an answer out, and talking still comes first', () => {
    expect(presenceWord({ talking: false, presence: 'listening', waiting: true })).toBe(
      'One moment',
    );
    expect(presenceWord({ talking: true, presence: 'listening', waiting: true })).toBe('Talking');
    expect(presenceWord({ talking: false, presence: 'listening' })).toBe('Listening');
  });

  it('waits about 8 seconds, and 12 for the owner', () => {
    expect(CONVERSE_WAIT_MS).toBe(8000);
    expect(OWNER_CONVERSE_WAIT_MS).toBe(12_000);
  });
});
