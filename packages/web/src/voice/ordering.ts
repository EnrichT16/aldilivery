/**
 * Understanding a spoken order. The words are understood in one place, `@aldilivery/core`, so
 * the app and the telephone line (ruling 28) hear an order the same way.
 */

export { parseChoice, parseQuantity, parseYesNo, splitItems, wantsToStop } from '@aldilivery/core';
