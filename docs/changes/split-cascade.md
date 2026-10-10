# Split cascade, baskets over £150, and bank transfer on (ruling 61, 10 October 2026)

What was built, in plain English. One database migration:
`20261023090000_split_cascade_and_baskets_over_150`.

## 1. Splitting a large order: motorbikes first

- A large order nobody who can carry it takes within **10 minutes** (`dispatch.splitAfterMinutes`,
  was 15) is split for the **fewest Runners possible**: motorbike riders first, then Runners on
  foot or bicycle, counting who is on shift, free and allowed right now.
- Each part carries up to `dispatch.splitPartMaxPenceByMode`: motorbike **£75**, foot or bicycle
  **£60**. Products are never split. Items go dearest first into the first part they fit,
  motorbike parts first.
- What the code computes (`planSplit`):

  | Basket | Motorbike riders on shift | Parts |
  | --- | --- | --- |
  | £150 | 2 or more | motorbike £75 + motorbike £75 |
  | £150 | 1 | motorbike £75 + foot £60 + foot £15 |
  | £150 | 0 | foot £60 + foot £60 + foot £30 |
  | £130 | 1 | motorbike £75 + foot £55 |

- A motorbike part is offered only to motorbike riders (a car or van Runner may take one too),
  with licence and insurance checked; a foot part only to Runners on foot or bicycle.
- If a part's kind of Runner goes off shift before anyone takes it, after another 10 minutes
  the parts nobody has taken are planned again with whoever is on shift (for example, a
  motorbike part of £75 becomes foot £60 + foot £15). Parts already taken carry on.
- Pay stays **£5 a part**. A three-way split pays £15 to Runners against a £13.50 delivery fee;
  the item charges cover the difference.
- The owner is texted when an order is split (naming each part), when the rest is planned
  again, and once if a part is still waiting after 15 minutes.

## 2. Baskets over £150

- One order carries up to £150 of shopping. Over that, the Shopper is told before paying, on
  the basket and confirmation screens, by Ozi and on the phone: "Your shopping is over £150,
  which is more than one Runner can carry. You can take something out or swap it to stay with
  one Runner, or keep everything and a second Runner will bring the rest for an extra £13.50
  delivery." Each order, its Runner and its delivery are listed.
- Keeping everything is an unticked box on the confirmation screen. Kept, the basket becomes
  linked orders: the first filled up to £150, then the next, up to **£450** in all
  (`fees.maximumBasketGoodsPence`, adjustable).
- The first order has the Shopper's usual delivery; **each further order is £13.50**
  (`fees.extraRunnerDeliveryPence`) whatever the plan. Example: £172 on pay as you go is £150
  with £13.50 delivery and £22 with £13.50 more.
- **A Runner who is not used is never charged for.** On a card, the £13.50 for each further
  Runner is taken only when that Runner collects the order. If the order is carried by the
  first Runner or cancelled first, nothing is taken; if it was taken, it goes back to the card.
  In a bank transfer it is paid up front, and given back as **Unused Runner fee credit** on the
  Shopper's account (shown in Settings, used on the next order).
- **Tiny extras**: a further order with under £5 of shopping (`dispatch.tinyExtraBelowPence`)
  is texted to the owner and listed in the admin panel's Payments tab with the first Runner's
  name and number. After asking the first Runner, press **Carry with the first Runner**: the
  items move to the first order and the extra £13.50 is not taken. Example: £151.50 kept.
- By phone, the most that can be taken is still £80, so a caller over £150 is told the choice
  and asked to use the app or website to keep everything.

## 3. Bank transfer is on

- `config/bank.json` now has `"enabled": true`. The checkout says a Runner is sent once the
  transfer arrives, that a Faster Payments transfer usually arrives within minutes, and that
  staff check at least every morning and evening. The owner is texted for each order.
- A basket kept whole is one transfer with one reference; staff mark it received once.

## 4. Runner agreement, version 10 October 2026

- `RUNNER_AGREEMENT_VERSION` is now 2026-10-10. The agreement page sets out £7 for £120 or more
  delivered whole, £5 a split part, how parts are offered, and the carrying limits. Every Runner
  is asked to agree again and is offered no job until they do.

## 5. Sign-in while texts are off

- With Twilio not set up, the sign-in form still shows when the demo sign-in for app store
  reviewers is configured, so the reviewers can use it. Nothing says the demo is set up; a real
  number is told "Signing in by text message is not switched on yet; please use the phone or
  computer you set up on."

## For Anthony

- Check the bank account details in `config/bank.json` once more now that it is live, and that
  someone checks the Payments tab every morning and evening.
- The £450 basket maximum, the £13.50 extra delivery and the £5 tiny-extra line are all in
  `config/store.json` and can be changed there.
- Merging a tiny extra lets the first order go a little over £150 (by under £5); the Runner's
  card and pay-back allow for that.
