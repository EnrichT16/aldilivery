/**
 * Filling an empty catalogue at startup.
 *
 * `prisma migrate deploy` makes tables, not rows, so the first deployment would otherwise
 * come up with nothing to buy. These tests prove that it fills itself once, that it never
 * fills itself twice, and — the one that matters — that it never invents a person.
 */

import { loadStoreConfig } from '@aldilivery/core/node';
import type { StoreConfig } from '@aldilivery/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { memoryRepository } from '../src/data/memory.js';
import type { Repository } from '../src/data/repository.js';
import { seedOnStartup } from '../src/data/startup-seed.js';
import { readEnv } from '../src/env.js';

const config = loadStoreConfig();

/** The same configuration with a different catalogue source, to prove the refusal. */
function withCatalogueMode(mode: 'partner_feed' | 'community'): StoreConfig {
  return {
    ...config,
    store: {
      ...config.store,
      catalogueSource: { ...config.store.catalogueSource, mode },
    },
  };
}

describe('seeding a real database at startup', () => {
  let repository: Repository;

  beforeEach(() => {
    repository = memoryRepository();
  });

  it('fills an empty catalogue, so a fresh deployment is a shop rather than a blank page', async () => {
    const outcome = await seedOnStartup(repository, config, { enabled: true });

    expect(outcome.seeded).toBe(true);
    const items = await repository.catalogue.search('', { limit: 100 });
    expect(items.length).toBeGreaterThan(20);
  });

  it('does nothing the second time, so a restart never duplicates the catalogue', async () => {
    await seedOnStartup(repository, config, { enabled: true });
    const afterFirst = await repository.catalogue.search('', {
      includeAgeRestricted: true,
      limit: 100,
    });

    const second = await seedOnStartup(repository, config, { enabled: true });

    expect(second).toEqual({ seeded: false, reason: 'already-seeded' });
    const afterSecond = await repository.catalogue.search('', {
      includeAgeRestricted: true,
      limit: 100,
    });
    expect(afterSecond.length).toBe(afterFirst.length);
  });

  it('does nothing at all when it is switched off', async () => {
    const outcome = await seedOnStartup(repository, config, { enabled: false });

    expect(outcome).toEqual({ seeded: false, reason: 'disabled' });
    expect(await repository.catalogue.search('', { limit: 5 })).toEqual([]);
  });

  it('refuses to seed a partner feed catalogue, rather than label estimates as a supermarket price', async () => {
    const outcome = await seedOnStartup(repository, withCatalogueMode('partner_feed'), {
      enabled: true,
    });

    expect(outcome).toEqual({ seeded: false, reason: 'not-community-catalogue' });
    expect(await repository.catalogue.search('', { limit: 5 })).toEqual([]);
  });

  /**
   * The one that matters. The development seed creates a Shopper and two Runners whose
   * right to work and criminal record checks are marked verified. In memory that is
   * harmless and thrown away at the end of the process. In a real database it would be a
   * fabricated person carrying exactly the two flags that decide who may take a job, handle
   * somebody's shopping, and be paid five pounds for it. Those checks are made by a person
   * reading a document. A seed script must never be able to assert one.
   */
  it('creates no people at all, and so no Runner that anything could offer a job to', async () => {
    await seedOnStartup(repository, config, { enabled: true });

    const runners = await repository.runners.listAvailable();
    expect(runners).toEqual([]);

    expect(await repository.shoppers.findByPhone('+447700900001')).toBeNull();
    expect(await repository.runners.findByPhone('+447700900101')).toBeNull();
  });

  it('still keeps the age restricted item out of an ordinary search (Rule Six)', async () => {
    await seedOnStartup(repository, config, { enabled: true });

    expect(await repository.catalogue.search('wine', { limit: 10 })).toEqual([]);

    // It is there, deliberately, so the refusal can be seen working.
    const all = await repository.catalogue.search('wine', {
      includeAgeRestricted: true,
      limit: 10,
    });
    expect(all.length).toBe(1);
    expect(all[0]?.ageRestricted).toBe(true);
  });
});

describe('SEED_ON_START', () => {
  it('is on unless it is explicitly turned off', () => {
    expect(readEnv({} as NodeJS.ProcessEnv).seedOnStart).toBe(true);
    expect(readEnv({ SEED_ON_START: 'true' } as NodeJS.ProcessEnv).seedOnStart).toBe(true);
    expect(readEnv({ SEED_ON_START: 'false' } as NodeJS.ProcessEnv).seedOnStart).toBe(false);
  });
});
