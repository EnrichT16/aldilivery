import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import {
  allowanceExtraPence,
  allowanceWords,
  deliveryFeePence,
  itemChargesForLines,
  priceBasketInParts,
  formatPence,
  productAllowed,
  RESTAURANT_MIXED_WORDS,
  restaurantMinimumWords,
  type BasketPartPricing,
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
   * More shopping than one basket holds (ruling 61: £450, several Runners). The order cannot
   * be sent as it is; the Shopper is told so in plain words.
   */
  overMaximum: boolean;
  /**
   * More shopping than one Runner carries (£150) but within one basket (ruling 61). The Shopper
   * chooses: take something out, or keep everything as `parts`, one Runner each, the first at
   * their plan price and each after it with the extra Runner's delivery. `pricing` is then the
   * keep-everything price.
   */
  overOneRunner: boolean;
  parts: readonly BasketPartPricing[];
  itemCount: number;
  /**
   * The monthly order allowance (ruling 73): what the Shopper is told about this order before
   * the yes ("This is your 6th order this month. Your plan includes 5, so this one has an extra
   * £5.99 delivery charge."), or null when there is nothing to say.
   */
  allowanceWords: string | null;
  /**
   * A restaurant order (Anthony, 30 October 2026): the restaurant it is from, when every dish is
   * from that one restaurant. Its pricing is the flat restaurant fee in place of delivery.
   */
  restaurant: { shopId: string; name: string } | null;
  /**
   * What stops the order being sent, in plain words, or null: restaurant dishes mixed with other
   * shopping or another restaurant's, or a restaurant basket below the smallest order. Shown on
   * the screen and said by Ozi.
   */
  restaurantProblem: string | null;
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
  // The monthly order allowance (ruling 73), exactly as the server counts it: this order is the
  // next one this calendar month.
  const allowancePlan = session?.shopper?.allowancePlan ?? 'payg';
  const orderNumber = (session?.shopper?.ordersThisMonth ?? 0) + 1;
  const extraPence = allowanceExtraPence(
    allowancePlan,
    orderNumber,
    storeConfig.fees.delivery.allowance,
  );
  const allowanceText = useMemo(
    () =>
      allowanceWords(allowancePlan, orderNumber, storeConfig.fees.delivery.allowance, (pence) =>
        formatPence(pence, storeConfig.store.currencySymbol),
      ),
    [allowancePlan, orderNumber],
  );

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

  // A restaurant order (Anthony, 30 October 2026): every dish from one restaurant, café or
  // takeaway. Dishes mixed with other shopping, or with another restaurant's, cannot go as one.
  const restaurants = lines.map((line) => line.item.restaurant ?? null);
  const firstRestaurant = restaurants[0] ?? null;
  const mixed =
    restaurants.some(Boolean) &&
    restaurants.some((ref) => ref === null || ref.shopId !== firstRestaurant?.shopId);
  const restaurantId = !mixed && firstRestaurant ? firstRestaurant.shopId : null;
  const restaurantName = !mixed && firstRestaurant ? firstRestaurant.name : null;

  const priced = useMemo<BasketPricing & { parts?: readonly BasketPartPricing[] }>(() => {
    const goodsPence = lines.reduce(
      (sum, line) => sum + line.item.estimatedPricePence * line.quantity,
      0,
    );
    // An empty basket has no fee to show. Rule Four means there is no minimum, so a basket
    // of one penny is priced exactly like any other.
    if (lines.length === 0) {
      return {
        goodsPence: 0,
        itemChargesPence: 0,
        feePence: 0,
        allowanceExtraPence: 0,
        totalPence: 0,
        plan,
      };
    }
    // Every unit carries its item charge (ruling 58), shown within its price.
    const itemChargesPence = itemChargesForLines(
      lines.map((line) => ({
        shopPricePence: line.item.estimatedPricePence,
        quantity: line.quantity,
      })),
      storeConfig.fees,
    );
    // A restaurant order: dishes at shop prices, the item charges, and the flat restaurant fee
    // in place of delivery, on every plan, with no extra delivery charge. One Runner always.
    if (restaurantId !== null) {
      const feePence = storeConfig.restaurants.feePence;
      return {
        goodsPence,
        itemChargesPence,
        feePence,
        allowanceExtraPence: 0,
        totalPence: goodsPence + itemChargesPence + feePence,
        plan,
      };
    }
    // Over one order but within one basket (ruling 61): priced as linked orders.
    if (
      goodsPence > storeConfig.fees.maximumOrderGoodsPence &&
      goodsPence <= storeConfig.fees.maximumBasketGoodsPence
    ) {
      const inParts = priceBasketInParts(
        lines.map((line) => ({
          key: line.item.id,
          unitPricePence: line.item.estimatedPricePence,
          quantity: line.quantity,
        })),
        plan,
        storeConfig.fees,
        extraPence,
      );
      return {
        goodsPence,
        itemChargesPence,
        feePence: inParts.feePence,
        allowanceExtraPence: inParts.allowanceExtraPence,
        totalPence: inParts.totalPence,
        plan,
        parts: inParts.parts,
      };
    }
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
      allowanceExtraPence: extraPence,
      totalPence: goodsPence + itemChargesPence + feePence + extraPence,
      plan,
    };
  }, [lines, plan, extraPence, restaurantId]);

  const pricing = useMemo<BasketPricing>(() => {
    const { parts: _parts, ...rest } = priced;
    return rest;
  }, [priced]);
  const parts = useMemo(() => priced.parts ?? [], [priced]);
  // A restaurant order is one Runner's: over what one order carries, it cannot go as it is.
  const overMaximum =
    pricing.goodsPence >
    (restaurantId !== null
      ? storeConfig.fees.maximumOrderGoodsPence
      : storeConfig.fees.maximumBasketGoodsPence);
  const overOneRunner = parts.length > 1;
  const restaurantProblem = mixed
    ? RESTAURANT_MIXED_WORDS
    : restaurantId !== null && pricing.goodsPence < storeConfig.restaurants.minimumOrderPence
      ? restaurantMinimumWords(storeConfig.restaurants, (pence) =>
          formatPence(pence, storeConfig.store.currencySymbol),
        )
      : null;
  const restaurantRef = useMemo(
    () =>
      restaurantId !== null && restaurantName !== null
        ? { shopId: restaurantId, name: restaurantName }
        : null,
    [restaurantId, restaurantName],
  );

  const value = useMemo<BasketValue>(
    () => ({
      lines,
      add,
      remove,
      setQuantity,
      clear,
      pricing,
      overMaximum,
      overOneRunner,
      parts,
      itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
      allowanceWords: lines.length === 0 || restaurantRef ? null : allowanceText,
      restaurant: restaurantRef,
      restaurantProblem,
    }),
    [
      lines,
      add,
      remove,
      setQuantity,
      clear,
      pricing,
      overMaximum,
      overOneRunner,
      parts,
      allowanceText,
      restaurantRef,
      restaurantProblem,
    ],
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
