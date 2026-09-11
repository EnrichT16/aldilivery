/**
 * Filling an empty real database with a catalogue, once, at startup.
 *
 * `prisma migrate deploy` creates tables. It does not create rows. Without this, the first
 * deployment comes up with an empty catalogue: search returns nothing, no basket can be
 * filled, and Aldilivery looks broken while in fact working perfectly. Seeding needs to
 * happen without anybody having a terminal, so it happens here.
 *
 * Three rules govern whether it runs, and all three have to agree.
 *
 * **The catalogue must be empty.** `seedRepository` checks this itself and does nothing to a
 * database that already has rows, so a restart never duplicates anything and never
 * overwrites a catalogue somebody has edited.
 *
 * **The catalogue source must be `community`.** The seeded rows carry the configured source
 * as their provenance. In `partner_feed` mode these community price estimates would be
 * labelled as though a supermarket had supplied them, which is a lie about where a price
 * came from, so seeding stops instead.
 *
 * **No people are ever created in a real database.** This is the important one. The
 * development seed creates a Shopper and two Runners whose right to work and criminal record
 * checks are marked verified, because in memory nothing is real and it is all thrown away
 * when the process stops. In PostgreSQL those same rows would be fabricated people, carrying
 * exactly the two flags that decide who may take a job, handle somebody's shopping and be
 * paid for it. Those checks are done by a person looking at a document, never by a seed
 * script, so only the catalogue is written here.
 */

import type { StoreConfig } from '@aldilivery/core';

import type { Repository } from './repository.js';
import { seedRepository } from './seed-data.js';

export interface StartupSeedOptions {
  /** Switched off with `SEED_ON_START=false`, for a catalogue that is managed elsewhere. */
  enabled: boolean;
}

export type StartupSeedOutcome =
  | { seeded: false; reason: 'disabled' | 'already-seeded' | 'not-community-catalogue' }
  | { seeded: true; catalogueItems: number };

/**
 * Returns what it did and why, rather than logging, so that the decision is testable and
 * the wording of the log line lives with the rest of the startup messages.
 */
export async function seedOnStartup(
  repository: Repository,
  config: StoreConfig,
  options: StartupSeedOptions,
): Promise<StartupSeedOutcome> {
  if (!options.enabled) {
    return { seeded: false, reason: 'disabled' };
  }

  if (config.store.catalogueSource.mode !== 'community') {
    return { seeded: false, reason: 'not-community-catalogue' };
  }

  // `withPeople: false` is the whole point. See the note above about verified checks.
  const result = await seedRepository(repository, config, { withPeople: false });

  if (result.alreadySeeded) {
    return { seeded: false, reason: 'already-seeded' };
  }

  return { seeded: true, catalogueItems: result.catalogueItems };
}
