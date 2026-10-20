# Real prices before any shop joins (ruling 72)

Anthony asked on 20 October 2026 for real prices before any shops have joined. He chose three lawful sources. Nothing is ever copied off a shop's own website, because that usually breaks the site's terms.

## Where prices come from, best first

1. **Till receipts.** The Runner already photographs the receipt. The language model reads the photo in the background. It is given only the photo and the names of the things on the order, and returns the price of one of each thing it can clearly read. Anything it cannot read is left out, and so is anything swapped for something else. This is our own data and the truest source.
2. **The open price database.** The open food database finds UK products and their barcodes by name. The open price database then gives recent prices in pounds for those barcodes. Prices older than a year, priced by the kilo, or in another currency are skipped. The databases ask each app to say who it is, so requests carry the product name and contact email.
3. **One web search.** This is used only when the database has nothing. The language model searches once, limited to the UK, and ends its answer with a fixed price line that the server reads. There are at most 100 searches a day, at about a penny each.

## How the estimate moves

Every price seen is kept as a price sighting. The catalogue estimate moves to the median of the latest five sightings from the best source that has one from the last 180 days.

- A Shop Partner's own list price is only ever corrected by a receipt.
- An outside price more than four times higher or lower than the estimate is left alone, because it is probably a different size.
- The Shopper still pays the till price. Nothing here touches an order or a payment.

## When lookups happen

- Straight away, in the background, when something new is added at an estimate.
- Every six hours, a sweep looks up ten more things. Estimates go first, then anything not seen for 30 days.

## Where to see it

The admin panel's Learning tab has a "Prices learned" list showing the price, the shop, the source and the date.

## Cost

Reading a receipt costs well under a penny. A web search costs about a penny, so at most about £1 a day. The open price database is free.
