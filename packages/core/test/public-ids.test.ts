/**
 * Speakable IDs for everyone (ruling 97): the shape of each kind, no confusable characters, and
 * how Ozi spells one out.
 */

import { describe, expect, it } from 'vitest';

import { loadStoreConfig } from '../src/node.js';
import {
  SPEAKABLE_ALPHABET,
  idReadOut,
  isSpeakableId,
  newPublicId,
  spellId,
} from '../src/public-ids.js';

const config = loadStoreConfig();

describe('speakable IDs', () => {
  it('leaves out 0, O, 1, I and L, the characters people mishear', () => {
    for (const confusable of ['0', 'O', '1', 'I', 'L']) {
      expect(SPEAKABLE_ALPHABET).not.toContain(confusable);
    }
  });

  it('makes each kind with its own letter and six characters from the configuration', () => {
    const random = (below: number): number => below - 1;
    expect(newPublicId('shopper', config.publicIds, random)).toBe('S-999999');
    expect(newPublicId('partner', config.publicIds, random)).toBe('P-999999');
    expect(newPublicId('organisation', config.publicIds, random)).toBe('G-999999');
    expect(newPublicId('staff', config.publicIds, random)).toBe('T-999999');
    const first = newPublicId('shopper', config.publicIds, () => 0);
    expect(first).toBe('S-AAAAAA');
    expect(isSpeakableId(first, 'shopper', config.publicIds)).toBe(true);
    expect(isSpeakableId(first, 'partner', config.publicIds)).toBe(false);
    expect(isSpeakableId('S-0OIL11', 'shopper', config.publicIds)).toBe(false);
    expect(isSpeakableId('S-AAA', 'shopper', config.publicIds)).toBe(false);
  });

  it('spells an ID in groups of three, so it is easy to hear and write down', () => {
    expect(spellId('S-7K4M2X')).toBe('S, 7 K 4, M 2 X');
    expect(spellId('RABCD234')).toBe('R, A B C, D 2 3, 4');
    expect(idReadOut('Shopper ID', 'S-7K4M2X')).toBe('Your Shopper ID is S, 7 K 4, M 2 X.');
  });

  it('reads the partner messages and note limits from the configuration', () => {
    expect(config.partnerOrders.messages['ready']).toBe('Ready for pickup');
    expect(Object.keys(config.partnerOrders.messages)).toHaveLength(4);
    expect(config.partnerOrders.historyDays).toBe(90);
    expect(config.partnerOrders.messageMinutesAfterDelivery).toBe(15);
    expect(config.notes).toEqual({ itemMaxChars: 120, orderMaxChars: 300 });
  });
});
