/**
 * Understanding a spoken order. The words are understood in one place, `@aldilivery/core`, so
 * the app and the telephone line (ruling 28) hear an order the same way, unit words included
 * (ruling 96: "five bunches of bananas").
 */

export {
  parseChoice,
  parseQuantity,
  parseSpokenItem,
  parseYesNo,
  splitItems,
  wantsToStop,
} from '@aldilivery/core';
