# Shops choosing their plan, paying at once, and scanning products (ruling 75)

Anthony decided these on 22 October 2026, before meeting shops in person. They build on ruling 65, which is described in partners.md. The prices are unchanged.

## Choosing free or paid on the join form

A shop joining at /business/join now sees "Choose your plan" straight after saying what kind of business it is. The two plans are set out side by side in a table with headings, so a screen reader reads each row with its heading and each plan by name. Nothing depends on colour.

What each plan gives, as built:

| What you get                                                     | Basic listing (free)     | Partner Plus (£14.99 a month) |
| ---------------------------------------------------------------- | ------------------------ | ----------------------------- |
| Name, address and opening hours                                  | Yes                      | Yes                           |
| Products                                                         | Up to 10                 | The full catalogue            |
| Adding products by scanning with the camera                      | Yes, up to 10            | Yes                           |
| Photos of products                                               | No                       | Yes                           |
| Offers                                                           | No                       | Yes                           |
| Shop of the Month                                                | Not eligible             | Eligible                      |
| Spotlight and Spotlight Plus (£19.99 and £39.99 a month, on top) | Not available            | Available                     |
| "Stock up at local shops" on the home page                       | After Partner Plus shops | Given priority                |
| In search and on the shops list                                  | Below Partner Plus shops | Above free shops              |

The figures come from `extras.partners` in config/store.json, never from code.

Under the table, the page says kindly and honestly that free listings may be reviewed as paid shops join, and that some may be taken off then, and that a shop can move to Partner Plus at any time to keep its place. Because of that, a shop is no longer told its listing is "free for ever" anywhere: not on the join page, in the welcome message, on the dashboard or on the statement. The first hundred free listings are still counted as before.

There are three ways to start:

- **Basic listing, free.** Joining finishes as it always did, and the shop lands on its dashboard.
- **Partner Plus: start with the free month.** The free month starts at once, at sign-up. No card is asked for. After the month the shop pays from its dashboard whenever it chooses, and nothing is ever taken without it.
- **Partner Plus: start and pay today.** This is for when Anthony agrees with a shop that it pays from the start. The free month is set aside, and straight after the form the shop is taken to Stripe's secure payment page for £14.99. The same code makes this page as the dashboard's "Pay for Partner Plus" button. When Stripe sends the shop back to its dashboard, the payment is checked and recorded once, as before. If the shop leaves Stripe's page without paying, its dashboard says Partner Plus is not paid and offers the button to pay.

Cafés, takeaways and services do not see the plan choice, because they have no monthly plan.

Ozi's voice guide on the join form asks the plan question too, for shops only. It reads the comparison briefly from configuration and says "say free, free month, or pay now". It understands those words and the usual ways of saying them.

## Partner Plus shops listed above free shops

The public shops list, and the home page's "Stock up at local shops" row (which reads the same list), now show shops on paid Partner Plus first. Every other shop follows, in the order it joined.

In search, only the places that shops' own products already hold are reordered. A Plus shop's product takes the first of those places, and a free shop's product the rest. Everything else in the results stays exactly where it was.

## Scanning products with the camera

Every shop can scan, on either plan. A free listing still stops at its ten products.

In the dashboard, "Scan products" has a button to start the camera. It opens the rear camera and captures by itself, with no button to press each time:

- **A barcode.** The browser's own barcode reader is used where there is one. Otherwise a small, well-known barcode library is loaded, only at the moment the camera opens, so the app is no slower for anyone who never scans. The barcode is looked up in the open food database for the product's name and size.
- **A shelf price label.** When the picture is held steady for about a second and a half, one frame is sent to be read by the language model. It reads the product's name, its size, the price in pence and the barcode digits, each only when it can clearly see them, and never guesses. Another frame is sent only after the camera has moved on to something new. A shop can have up to 400 labels read in a day.

Each capture becomes a draft in a list: name, price and barcode, and for a Partner Plus shop the camera's picture as the product's photo. Every capture makes a click and a short buzz, and Ozi says it, for example "Got it: Braeburn apples, 6 pack, £2.40". The same words appear on the screen in a status line a screen reader announces.

The shop checks the list and corrects it by typing, or by voice: "change the price of apples to £2.50", "the price is two pounds", "call it Welsh cakes", "remove the beans", "read the list", "stop scanning". Saying "scan products" starts the camera.

Nothing reaches the shop's catalogue until the shop presses "Add all", or says "add all" and then yes. The products then go through the ordinary add-a-product route, so a person still checks every one before Shoppers see it.

One product is one listing with one price, however many identical packs are on the shelf. If the same barcode, or the same name with the same price, is captured again, it is not added twice: Ozi says "Already added". The server refuses a repeat too, whether it is scanned or typed.

"Take a photo" and "Upload photos" of labels are still there, and their photos are read the same way. The ordinary form for typing a product in, with its own photo for Partner Plus shops, is unchanged, and so is adding a product by voice.

## When the label shows no price

The draft takes an estimate instead: the catalogue's own estimate for the closest name, or else the language model's typical UK price. It is shown as "Estimate, please check the price". When the shop types or says a price, the mark goes.

A product sent with an estimate is kept marked as such. The shop sees "The price is an estimate: please check it" on its products, and staff see the mark in the list of products waiting to be checked, so the owner's queue of things to look at can pick these up. When the shop sets the price, the mark is cleared.

## Spotlight from the dashboard

A shop on paid Partner Plus can now buy or renew Spotlight and Spotlight Plus with buttons in its dashboard, through the same Stripe page as the plan. Before, it had to ring us.

## Not built yet

- Partner Plus lists "offers", but there is no way yet for a shop to create its own offers. That needs its own design.
- Shop of the Month counts any shop on Partner Plus, whether or not this month is paid.
- A free listing being "reviewed and removed later" is done by a person in the admin panel, as any shop can be paused or removed today. There is no automatic review.

## Where it is

- The join form: `packages/web/src/pages/PartnerJoin.tsx`.
- The scanner: `packages/web/src/components/ProductScanner.tsx`, used by `packages/web/src/pages/PartnerDashboard.tsx`.
- The routes: `POST /partner/join` (now with `payNow`), `POST /partner/scan/label`, `POST /partner/scan/barcode` and the duplicate check on `POST /partner/products`, in `packages/api/src/routes/business.ts`; the search order in `packages/api/src/routes/catalogue.ts`.
- Reading a label: the optional `readLabel` in `packages/api/src/lib/language-model.ts`. A barcode's name: `lookUpBarcode` in `packages/api/src/lib/open-prices.ts`. The estimate: `estimatedPricePence` in `packages/api/src/services/suggest.ts`.
- New migration `20261030140000_partner_product_scan`, adding a product's barcode and its estimate mark.
- Tests: `packages/api/test/partner-scan.test.ts`, the label cases in `packages/api/test/language-model.test.ts`, and `packages/web/test/partner-join.test.tsx`.
