import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { feeForGoodsPence, type BasketPricing } from '@aldilivery/core';

import { storeConfig } from '../config';
import type { CatalogueItem } from '../lib/api';

export interface BasketLine {
  item: CatalogueItem;
  quantity: number;
}

interface BasketValue {
  lines: BasketLine[];
  add: (item: CatalogueItem) => void;
  remove: (itemId: string) => void;
  setQuantity: (itemId: string, quantity: number) => void;
  clear: () => void;
  pricing: BasketPricing;
  /**
   * More shopping than one delivery carries. The Shopper is told so in plain words and offered
   * two deliveries; the order cannot be sent as it is.
   */
  overMaximum: boolean;
  itemCount: number;
}

const BasketContext = createContext<BasketValue | null>(null);

/**
 * The basket, and the price of it.
 *
 * The fee is worked out with the very same function the server uses, from the very same
 * figures in `config/store.json`. The two cannot drift, so what the Shopper is shown before
 * they confirm is what they will be charged.
 */
export function BasketProvider({ children }: { children: ReactNode }): JSX.Element {
  const [lines, setLines] = useState<BasketLine[]>([]);

  const add = useCallback((item: CatalogueItem) => {
    setLines((current) => {
      const existing = current.find((line) => line.item.id === item.id);
      if (existing) {
        return current.map((line) =>
          line.item.id === item.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [...current, { item, quantity: 1 }];
    });
  }, []);

  const remove = useCallback((itemId: string) => {
    setLines((current) => current.filter((line) => line.item.id !== itemId));
  }, []);

  const setQuantity = useCallback((itemId: string, quantity: number) => {
    setLines((current) =>
      quantity <= 0
        ? current.filter((line) => line.item.id !== itemId)
        : current.map((line) => (line.item.id === itemId ? { ...line, quantity } : line)),
    );
  }, []);

  const clear = useCallback(() => {
    setLines([]);
  }, []);

  const pricing = useMemo<BasketPricing>(() => {
    const goodsPence = lines.reduce(
      (sum, line) => sum + line.item.estimatedPricePence * line.quantity,
      0,
    );
    // An empty basket has no fee to show. Rule Four means there is no minimum, so a basket
    // of one penny is priced exactly like any other.
    if (goodsPence === 0) {
      return { goodsPence: 0, feePence: 0, totalPence: 0 };
    }
    // Over the maximum, the fee is still the flat fee; `overMaximum` says it cannot go as one.
    const feePence =
      goodsPence > storeConfig.fees.maximumGoodsPence
        ? storeConfig.fees.standardDeliveryPence
        : feeForGoodsPence(goodsPence, storeConfig.fees);
    return { goodsPence, feePence, totalPence: goodsPence + feePence };
  }, [lines]);

  const overMaximum = pricing.goodsPence > storeConfig.fees.maximumGoodsPence;

  const value = useMemo<BasketValue>(
    () => ({
      lines,
      add,
      remove,
      setQuantity,
      clear,
      pricing,
      overMaximum,
      itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    }),
    [lines, add, remove, setQuantity, clear, pricing, overMaximum],
  );

  return <BasketContext.Provider value={value}>{children}</BasketContext.Provider>;
}

export function useBasket(): BasketValue {
  const value = useContext(BasketContext);
  if (!value) {
    throw new Error('useBasket was used outside a BasketProvider.');
  }
  return value;
}
