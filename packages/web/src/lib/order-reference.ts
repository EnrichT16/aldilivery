/**
 * The short reference for an order, the same one a Runner sees on their jobs and payouts
 * (packages/api/src/routes/runner-account.ts, `orderReference`), so a Shopper and a Runner
 * talking about an order mean the same thing. Never the long system ID.
 */
export function orderReference(orderId: string): string {
  return `OZ-${orderId
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-6)
    .toUpperCase()}`;
}
