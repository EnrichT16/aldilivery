/**
 * Paying by bank transfer straight to the business account (ruling 50, Anthony, 7 October 2026).
 *
 * The account and whether it is switched on are in `config/bank.json`. Each order gets its own
 * reference so a transfer can be matched to it. Nothing is sent to a Runner until a person has
 * seen the money arrive and marked it as received in the admin panel's Payments tab. The owner
 * is told by text at once, on his own channel, if OWNER_ALERT_PHONE is set.
 */

import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { formatPence } from '@aldilivery/core';
import { storeConfigPath } from '@aldilivery/core/node';
import type { FastifyBaseLogger } from 'fastify';

import type { AppContext } from '../app.js';
import type { Order } from '../domain.js';

export interface BankSettings {
  enabled: boolean;
  accountName: string;
  sortCode: string;
  accountNumber: string;
  referencePrefix: string;
  payWithinHours: number;
}

let cached: BankSettings | null = null;

export function bankSettings(explicitConfigPath?: string): BankSettings {
  if (!cached) {
    const raw = JSON.parse(
      readFileSync(join(dirname(storeConfigPath(explicitConfigPath)), 'bank.json'), 'utf8'),
    ) as Partial<BankSettings>;
    cached = {
      enabled: raw.enabled === true,
      // "{legalEntityName}" stands for the company's name in config/store.json, which Rule Nine
      // keeps in that one file; the business account is held in the company's own name.
      accountName: String(raw.accountName ?? '').replace('{legalEntityName}', () => {
        const store = JSON.parse(readFileSync(storeConfigPath(explicitConfigPath), 'utf8')) as {
          store?: { legalEntityName?: string };
        };
        return store.store?.legalEntityName ?? '';
      }),
      sortCode: String(raw.sortCode ?? ''),
      accountNumber: String(raw.accountNumber ?? ''),
      referencePrefix: String(raw.referencePrefix ?? 'REF').toUpperCase(),
      payWithinHours: Number(raw.payWithinHours ?? 24),
    };
  }
  return cached;
}

/** For tests: switch bank transfers on or off without touching the file. */
export function setBankSettings(settings: BankSettings | null): void {
  cached = settings;
}

const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** "OZI-7K3Q2M": short enough to type into a banking app, with no easily confused letters. */
export function bankReference(prefix: string): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) code += LETTERS[randomInt(LETTERS.length)];
  return `${prefix}-${code}`;
}

/** Tells the owner, by text, that a bank transfer order is waiting to be checked. */
export async function alertPayments(
  ctx: AppContext,
  order: Order,
  log: FastifyBaseLogger,
): Promise<void> {
  if (!ctx.env.ownerAlertPhone || !ctx.sendText) return;
  try {
    await ctx.sendText(
      ctx.env.ownerAlertPhone,
      `${ctx.config.productName} payments: a bank transfer order of ${formatPence(order.totalEstimatePence, ctx.config.store.currencySymbol)}, reference ${order.bankReference}, is waiting. Check the Payments tab when it arrives.`,
    );
  } catch (failure) {
    log.warn({ err: failure, orderId: order.id }, 'The owner could not be told about a payment.');
  }
}
