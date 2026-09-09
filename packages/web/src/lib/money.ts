import { formatPence } from '@aldilivery/core';

import { storeConfig } from '../config';

/** Money on screen, always through one function, always from configuration. */
export function money(pence: number): string {
  return formatPence(pence, storeConfig.store.currencySymbol);
}
