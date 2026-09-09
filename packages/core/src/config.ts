/**
 * The store configuration contract.
 *
 * Rule Nine: store identity, name, colours, catalogue source and legal entity are
 * configuration, never code. Everything the product knows about the supermarket it shops
 * at lives in `config/store.json` and arrives in the application through this file.
 *
 * The parser is deliberately strict, and it does more than check shapes. It also refuses
 * any configuration that contradicts an inviolable rule — a fee band that would lose money,
 * a Runner payment that is not five pounds, a notice period that is not thirty minutes, an
 * age restriction switched on. A JSON edit cannot break a promise: the process will not
 * start, and the error says exactly which rule was contradicted.
 */

import {
  AGE_RESTRICTED_GOODS_ALLOWED,
  MINIMUM_NET_PENCE,
  RUNNER_PAYMENT_PENCE,
  SET_NOTICE_MINUTES_BEFORE,
} from './rules.js';
import { assertBandsHonourNetFloor, type FeeBand, type ProcessorModel } from './fees.js';

export type CatalogueSourceMode = 'partner_feed' | 'community';

export interface StoreConfig {
  readonly configVersion: number;
  readonly productName: string;
  readonly assistantName: string;
  readonly tagline: string;
  readonly contact: {
    readonly telephonePlaceholder: string;
    readonly telephoneIsPlaceholder: boolean;
  };
  readonly store: {
    readonly displayName: string;
    readonly legalEntityName: string;
    readonly legalEntityIsPlaceholder: boolean;
    readonly country: string;
    readonly currency: string;
    readonly currencySymbol: string;
    readonly catalogueSource: {
      readonly mode: CatalogueSourceMode;
      readonly allowedModes: readonly CatalogueSourceMode[];
      readonly attribution: string;
    };
  };
  readonly brand: {
    readonly colours: {
      readonly navy: string;
      readonly gold: string;
      readonly white: string;
    };
  };
  readonly fees: {
    readonly currency: string;
    readonly runnerPaymentPence: number;
    readonly minimumNetPence: number;
    readonly maximumGoodsPence: number;
    readonly bands: readonly FeeBand[];
    readonly processor: ProcessorModel;
    readonly coolBag: {
      readonly depositPence: number;
      /** Taken from each early payout until the deposit is collected. Never all at once:
       *  a Runner must not work a shift for nothing. */
      readonly withholdPerOrderPence: number;
      readonly releaseAfterCompletedDeliveries: number;
    };
  };
  readonly payments: {
    readonly provider: string;
    readonly supportedCardRegions: readonly string[];
  };
  readonly allocation: {
    readonly offerHoldSeconds: number;
    readonly poolingRadiusMiles: number;
  };
  readonly recurringOrders: {
    readonly noticeMinutesBefore: number;
    readonly skipWord: string;
  };
  readonly accountDeletion: {
    readonly recycleBinDays: number;
  };
  readonly accessibility: {
    readonly targetStandard: string;
    readonly baseFontSizePx: number;
    readonly minimumControlHeightPx: number;
  };
  readonly versionOneRestrictions: {
    readonly ageRestrictedGoodsAllowed: boolean;
  };
}

export class StoreConfigError extends Error {
  constructor(message: string) {
    super(`config/store.json is not usable: ${message}`);
    this.name = 'StoreConfigError';
  }
}

type Unknown = Record<string, unknown>;

function object(value: unknown, path: string): Unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new StoreConfigError(`${path} must be an object.`);
  }
  return value as Unknown;
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new StoreConfigError(`${path} must be a non-empty string.`);
  }
  return value;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new StoreConfigError(`${path} must be true or false.`);
  }
  return value;
}

function wholeNumber(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new StoreConfigError(`${path} must be a whole number of at least ${minimum}.`);
  }
  return value;
}

function positiveNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new StoreConfigError(`${path} must be a number greater than zero.`);
  }
  return value;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new StoreConfigError(`${path} must be a non-empty array.`);
  }
  return value;
}

const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/;

function hexColour(value: unknown, path: string): string {
  const colour = str(value, path);
  if (!HEX_COLOUR.test(colour)) {
    throw new StoreConfigError(`${path} must be a six digit hex colour such as #0B1F3A, received "${colour}".`);
  }
  return colour.toUpperCase();
}

function equals(actual: number, expected: number, path: string, rule: string): number {
  if (actual !== expected) {
    throw new StoreConfigError(
      `${path} is ${actual} but ${rule} requires ${expected}. ` +
        `This value is a rule, not a setting; change the rule in RULES.md and in packages/core/src/rules.ts, or leave it alone.`,
    );
  }
  return actual;
}

function parseBands(value: unknown, path: string): FeeBand[] {
  const raw = array(value, path);
  const bands = raw.map((entry, index) => {
    const band = object(entry, `${path}[${index}]`);
    return {
      uptoPence: wholeNumber(band['uptoPence'], `${path}[${index}].uptoPence`, 1),
      feePence: wholeNumber(band['feePence'], `${path}[${index}].feePence`, 1),
    } satisfies FeeBand;
  });

  for (let i = 1; i < bands.length; i += 1) {
    const previous = bands[i - 1] as FeeBand;
    const current = bands[i] as FeeBand;
    if (current.uptoPence <= previous.uptoPence) {
      throw new StoreConfigError(
        `${path} must be in ascending order of uptoPence; band ${i} ends at ${current.uptoPence}p which is not above band ${i - 1} ending at ${previous.uptoPence}p.`,
      );
    }
  }

  return bands;
}

function parseCatalogueMode(value: unknown, path: string, allowed: readonly string[]): CatalogueSourceMode {
  const mode = str(value, path);
  if (!allowed.includes(mode)) {
    throw new StoreConfigError(`${path} must be one of ${allowed.join(', ')}, received "${mode}".`);
  }
  return mode as CatalogueSourceMode;
}

/**
 * Validate a raw parsed JSON value and return a typed, trusted `StoreConfig`.
 *
 * Throws `StoreConfigError` with a plain sentence saying what is wrong. Nothing in the
 * application reads store configuration by any other route.
 */
export function parseStoreConfig(input: unknown): StoreConfig {
  const root = object(input, 'the configuration file');

  const contact = object(root['contact'], 'contact');
  const store = object(root['store'], 'store');
  const catalogueSource = object(store['catalogueSource'], 'store.catalogueSource');
  const brand = object(root['brand'], 'brand');
  const colours = object(brand['colours'], 'brand.colours');
  const fees = object(root['fees'], 'fees');
  const processorRaw = object(fees['processor'], 'fees.processor');
  const coolBag = object(fees['coolBag'], 'fees.coolBag');
  const payments = object(root['payments'], 'payments');
  const allocation = object(root['allocation'], 'allocation');
  const recurringOrders = object(root['recurringOrders'], 'recurringOrders');
  const accountDeletion = object(root['accountDeletion'], 'accountDeletion');
  const accessibility = object(root['accessibility'], 'accessibility');
  const versionOneRestrictions = object(root['versionOneRestrictions'], 'versionOneRestrictions');

  const allowedModes = array(catalogueSource['allowedModes'], 'store.catalogueSource.allowedModes').map(
    (entry, index) => str(entry, `store.catalogueSource.allowedModes[${index}]`),
  );
  for (const mode of allowedModes) {
    if (mode !== 'partner_feed' && mode !== 'community') {
      throw new StoreConfigError(
        `store.catalogueSource.allowedModes may only contain partner_feed or community, received "${mode}".`,
      );
    }
  }

  const bands = parseBands(fees['bands'], 'fees.bands');
  const processor: ProcessorModel = {
    percentageBasisPoints: wholeNumber(
      processorRaw['percentageBasisPoints'],
      'fees.processor.percentageBasisPoints',
    ),
    fixedPence: wholeNumber(processorRaw['fixedPence'], 'fees.processor.fixedPence'),
  };

  const maximumGoodsPence = wholeNumber(fees['maximumGoodsPence'], 'fees.maximumGoodsPence', 1);
  const topBand = bands[bands.length - 1] as FeeBand;
  if (topBand.uptoPence !== maximumGoodsPence) {
    throw new StoreConfigError(
      `fees.maximumGoodsPence is ${maximumGoodsPence}p but the last fee band ends at ${topBand.uptoPence}p. ` +
        `They must agree, otherwise a basket could be accepted that no band can price.`,
    );
  }

  // Rule Two, Rule Three, Rule Five and Rule Six are checked against the constants, not
  // trusted from the file.
  const minimumNetPence = equals(
    wholeNumber(fees['minimumNetPence'], 'fees.minimumNetPence'),
    MINIMUM_NET_PENCE,
    'fees.minimumNetPence',
    'Rule Three',
  );
  equals(
    wholeNumber(fees['runnerPaymentPence'], 'fees.runnerPaymentPence'),
    RUNNER_PAYMENT_PENCE,
    'fees.runnerPaymentPence',
    'Rule Two',
  );
  equals(
    wholeNumber(recurringOrders['noticeMinutesBefore'], 'recurringOrders.noticeMinutesBefore'),
    SET_NOTICE_MINUTES_BEFORE,
    'recurringOrders.noticeMinutesBefore',
    'Rule Five',
  );

  const ageRestrictedGoodsAllowed = bool(
    versionOneRestrictions['ageRestrictedGoodsAllowed'],
    'versionOneRestrictions.ageRestrictedGoodsAllowed',
  );
  if (ageRestrictedGoodsAllowed !== AGE_RESTRICTED_GOODS_ALLOWED) {
    throw new StoreConfigError(
      'versionOneRestrictions.ageRestrictedGoodsAllowed must be false. Rule Six: no age restricted goods in version one.',
    );
  }

  // Rule Three again, this time against the actual bands.
  assertBandsHonourNetFloor(bands, processor, minimumNetPence);

  const skipWord = str(recurringOrders['skipWord'], 'recurringOrders.skipWord');
  if (/\s/.test(skipWord.trim()) || skipWord.trim() === '') {
    throw new StoreConfigError(
      `recurringOrders.skipWord must be a single word with no spaces, received "${skipWord}". Rule Five: the skip is one word.`,
    );
  }

  const minimumControlHeightPx = wholeNumber(
    accessibility['minimumControlHeightPx'],
    'accessibility.minimumControlHeightPx',
    1,
  );
  if (minimumControlHeightPx < 48) {
    throw new StoreConfigError(
      `accessibility.minimumControlHeightPx is ${minimumControlHeightPx} but every control must be at least 48 pixels tall. Rule Seven.`,
    );
  }

  const baseFontSizePx = wholeNumber(accessibility['baseFontSizePx'], 'accessibility.baseFontSizePx', 1);
  if (baseFontSizePx < 16) {
    throw new StoreConfigError(
      `accessibility.baseFontSizePx is ${baseFontSizePx} which is too small for the people this product is built for. Rule Seven.`,
    );
  }

  const coolBagDepositPence = wholeNumber(coolBag['depositPence'], 'fees.coolBag.depositPence');
  const coolBagWithholdPerOrderPence = wholeNumber(
    coolBag['withholdPerOrderPence'],
    'fees.coolBag.withholdPerOrderPence',
    1,
  );
  if (coolBagWithholdPerOrderPence >= RUNNER_PAYMENT_PENCE) {
    throw new StoreConfigError(
      `fees.coolBag.withholdPerOrderPence is ${coolBagWithholdPerOrderPence}p, which is not less than the ${RUNNER_PAYMENT_PENCE}p a Runner earns per order. ` +
        `A Runner must never finish a delivery with nothing. Rule Two.`,
    );
  }
  if (coolBagWithholdPerOrderPence > coolBagDepositPence) {
    throw new StoreConfigError(
      `fees.coolBag.withholdPerOrderPence is ${coolBagWithholdPerOrderPence}p, which is more than the whole ${coolBagDepositPence}p deposit.`,
    );
  }

  const supportedCardRegions = array(
    payments['supportedCardRegions'],
    'payments.supportedCardRegions',
  ).map((entry, index) => str(entry, `payments.supportedCardRegions[${index}]`));

  return {
    configVersion: wholeNumber(root['configVersion'], 'configVersion', 1),
    productName: str(root['productName'], 'productName'),
    assistantName: str(root['assistantName'], 'assistantName'),
    tagline: str(root['tagline'], 'tagline'),
    contact: {
      telephonePlaceholder: str(contact['telephonePlaceholder'], 'contact.telephonePlaceholder'),
      telephoneIsPlaceholder: bool(contact['telephoneIsPlaceholder'], 'contact.telephoneIsPlaceholder'),
    },
    store: {
      displayName: str(store['displayName'], 'store.displayName'),
      legalEntityName: str(store['legalEntityName'], 'store.legalEntityName'),
      legalEntityIsPlaceholder: bool(store['legalEntityIsPlaceholder'], 'store.legalEntityIsPlaceholder'),
      country: str(store['country'], 'store.country'),
      currency: str(store['currency'], 'store.currency'),
      currencySymbol: str(store['currencySymbol'], 'store.currencySymbol'),
      catalogueSource: {
        mode: parseCatalogueMode(catalogueSource['mode'], 'store.catalogueSource.mode', allowedModes),
        allowedModes: allowedModes as readonly CatalogueSourceMode[],
        attribution: str(catalogueSource['attribution'], 'store.catalogueSource.attribution'),
      },
    },
    brand: {
      colours: {
        navy: hexColour(colours['navy'], 'brand.colours.navy'),
        gold: hexColour(colours['gold'], 'brand.colours.gold'),
        white: hexColour(colours['white'], 'brand.colours.white'),
      },
    },
    fees: {
      currency: str(fees['currency'], 'fees.currency'),
      runnerPaymentPence: RUNNER_PAYMENT_PENCE,
      minimumNetPence,
      maximumGoodsPence,
      bands,
      processor,
      coolBag: {
        depositPence: wholeNumber(coolBag['depositPence'], 'fees.coolBag.depositPence'),
        withholdPerOrderPence: coolBagWithholdPerOrderPence,
        releaseAfterCompletedDeliveries: wholeNumber(
          coolBag['releaseAfterCompletedDeliveries'],
          'fees.coolBag.releaseAfterCompletedDeliveries',
          1,
        ),
      },
    },
    payments: {
      provider: str(payments['provider'], 'payments.provider'),
      supportedCardRegions,
    },
    allocation: {
      offerHoldSeconds: wholeNumber(allocation['offerHoldSeconds'], 'allocation.offerHoldSeconds', 1),
      poolingRadiusMiles: positiveNumber(allocation['poolingRadiusMiles'], 'allocation.poolingRadiusMiles'),
    },
    recurringOrders: {
      noticeMinutesBefore: SET_NOTICE_MINUTES_BEFORE,
      skipWord: skipWord.trim().toLowerCase(),
    },
    accountDeletion: {
      recycleBinDays: wholeNumber(accountDeletion['recycleBinDays'], 'accountDeletion.recycleBinDays', 1),
    },
    accessibility: {
      targetStandard: str(accessibility['targetStandard'], 'accessibility.targetStandard'),
      baseFontSizePx,
      minimumControlHeightPx,
    },
    versionOneRestrictions: {
      ageRestrictedGoodsAllowed,
    },
  };
}

export type { FeeBand, ProcessorModel };
