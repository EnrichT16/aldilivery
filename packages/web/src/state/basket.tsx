import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import {
  deliveryFeePence,
  itemChargesForLines,
  productAllowed,
  type BasketPricing,
  type DeliveryPlan,
} from '@aldilivery/core';

import { storeConfig } from '../config';
import type { CatalogueItem } from '../lib/api';
import { useOptionalSession } from './session';

export interface BasketLine {
  item: CatalogueItem;
  quantity: number;
}

interface BasketValue {
  lines: BasketLine[];
  /**
   * Puts one more in the basket. Refused, with nothing added, for a product dearer than any one
   * product may be (ruling 58: no single product over £60); the screen says so in plain words.
   */
  add: (item: CatalogueItem) => boolean;
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
 * The item charges and the delivery fee are worked out with the very same functions the server
 * uses, from the very same figures in `config/store.json`, for the Shopper's own plan. The two cannot drift, so what the Shopper is shown before
 * they confirm is what they will be charged.
 */
export function BasketProvider({ children }: { children: ReactNode }): JSX.Element {
  const [lines, setLines] = useState<BasketLine[]>([]);

  const session = useOptionalSession();
  // The delivery price follows the signed-in Shopper's plan, exactly as the server decides it.
  const plan: DeliveryPlan = session?.shopper?.deliveryPlan ?? 'payg';

  const add = useCallback((item: CatalogueItem): boolean => {
    if (!productAllowed(item.estimatedPricePence, storeConfig.fees)) return false;
    setLines((current) => {
      const existing = current.find((line) => line.item.id === item.id);
      if (existing) {
        return current.map((line) =>
          line.item.id === item.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [...current, { item, quantity: 1 }];
    });
    return true;
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
    if (lines.length === 0) {
      return { goodsPence: 0, itemChargesPence: 0, feePence: 0, totalPence: 0, plan };
    }
    // Every unit carries its item charge (ruling 58), shown within its price.
    const itemChargesPence = itemChargesForLines(
      lines.map((line) => ({
        shopPricePence: line.item.estimatedPricePence,
        quantity: line.quantity,
      })),
      storeConfig.fees,
    );
    // Over the maximum, the fee shown is the one for the most one order carries;
    // `overMaximum` says it cannot go as one.
    const feePence = deliveryFeePence(
      Math.min(goodsPence, storeConfig.fees.maximumOrderGoodsPence),
      plan,
      storeConfig.fees,
    );
    return {
      goodsPence,
      itemChargesPence,
      feePence,
      totalPence: goodsPence + itemChargesPence + feePence,
      plan,
    };
  }, [lines, plan]);

  const overMaximum = pricing.goodsPence > storeConfig.fees.maximumOrderGoodsPence;

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
