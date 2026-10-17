# Shop of the Month and review points (ruling 70)

Anthony's decisions of 16 and 17 October 2026, recorded as ruling 70 in docs/BUILD_PROMPT.md.

## What a Shopper sees

- After a delivery with a Shop Partner's things in it, **Past orders** has a "Rate your shops"
  section: the shop's name, five star buttons each with its words ("4 stars"), a few words if
  they like, and "Send my rating of <shop>". Saying "four stars" rates the first shop waiting.
- The points balance is always said in words: "You have 40 points, worth 40p. From 100 points,
  £1.00 comes off your next order."
- Every honest rating earns the same 10 points, one star or five. The points wait 7 days, are
  lost if the order is refunded, and from 100 points become delivery credit on the next order,
  exactly as gift card and feedback credit are. One rewarded rating per shop a month. Points
  have no cash value. The existing £1 delivery-feedback credit is unchanged.

## Shop of the Month

- Monthly, quarterly and half-yearly, by the calendar, among approved shops on Partner Plus with
  at least 10 ratings in the period, ranked by a balanced score:
  (ratings × mean + 10 × global mean) / (ratings + 10).
- The holders of the last finished month, quarter and half year wear a badge with words
  ("Shop of the Month, September 2026") on the public /shops list and on their own page.
- Staff see the full standings for this month, quarter and half year in Shops and organisations.
- No names anywhere: counts and averages only.

## Settings, in `feedback.reviews` of config/store.json

| Setting                        | Default |
| ------------------------------ | ------- |
| `pointsPerReview`              | 10      |
| `pencePerPoint`                | 1       |
| `spendFromPoints`              | 100     |
| `pendingDays`                  | 7       |
| `askWithinDays`                | 14      |
| `shopOfTheMonthMinimumReviews` | 10      |
| `shopOfTheMonthPriorWeight`    | 10      |

Ozi blanks: `{reviewPoints}`, `{pointsForPound}`, `{pointsPendingDays}`, `{reviewMinimum}`.

## Where it lives

- Rules: `packages/api/src/services/shop-of-the-month.ts` (periods, pending reviews, the
  balance, conversion into credit, the hourly `settleShopReviews`, standings and awards).
- Routes: `packages/api/src/routes/reviews.ts` (`/me/reviews/pending`, `/me/reviews`,
  `/orders/:id/shop-review`, `/shops/of-the-month`, `/staff/shop-of-the-month`); `awards` on
  `/shops` and `/shops/:id` in `routes/business.ts`.
- Sweep: beside the retention sweep in `packages/api/src/index.ts`.
- Data: `ShopReview` and `ReviewPointsSpend` (migration `20261027090000_shop_of_the_month`),
  `repository.shopReviews` in memory and Prisma.
- Web: `components/ShopReviews.tsx` on `pages/Orders.tsx`; badges in `pages/Shops.tsx`; the
  `ShopOfTheMonth` section in `pages/Staff.tsx`.
- Tests: `packages/api/test/shop-of-the-month.test.ts`, `packages/web/test/shop-reviews.test.tsx`.

## Open questions for Anthony

- Should the £1 delivery-feedback credit become points as well?
- A certificate for the winning shop (nothing is made yet).
