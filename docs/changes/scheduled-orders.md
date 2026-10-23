# Ordering now for a later day

Decided by Anthony on 23 October 2026, recorded as ruling 78 in docs/BUILD_PROMPT.md. It builds on the saved cards and Stripe customers, Rule One, the till settlement (ruling 52), paying by bank transfer (rulings 50 and 61), the weekly shop (rulings 36 and 37), the plans and their monthly allowance (rulings 58, 63 and 73), dispatch, and Ozi's desk (ruling 74).

## Why

Many people know their week. Some are paid on a set day and would rather the money left their account then, not before. Others want their shopping on a Saturday morning when somebody is home to open the door. Until now an order could only be for as soon as possible and was paid at the yes.

## Choosing the day

At checkout, on the screen, by voice and on the telephone, the Shopper chooses as soon as possible, as before, or another day, from tomorrow up to 28 days ahead. On the screen, a list of the days shows each in words, such as Saturday 31 October. Then they choose the time of day: morning, 8:00 to 12:00; afternoon, 12:00 to 17:00; or evening, 17:00 to 21:00. An organisation ordering for a person does the same, because it uses the same checkout.

By voice, at the question that sends the order, the Shopper can say "deliver it on Saturday morning", "next week", "in two weeks" or "on the first". On the telephone the same words work when Ozi reads the order back. Ozi then reads the whole order back again, with the day, and asks for the yes.

The order is kept as booked. It is not offered to any Runner until its day: 90 minutes before its window starts, it goes to Runners through the usual dispatch like any other order. A basket too big for one Runner can only be sent for as soon as possible at the moment.

## When the money is taken

The Shopper chooses.

- **Now.** The money is taken at the yes, as it always has been. It is taken, not only held, because a hold on a card runs out after seven days.
- **On a day and time they choose.** For example on payday: "take the money on the first at five past midnight". The day can be any day up to the delivery day, and the time any time, five past midnight unless they say otherwise; they know when their wages or benefits arrive. It must be before a Runner would be sent. At that moment the saved card is charged, with nobody at the screen. If the card is refused, it is tried again every hour, up to six tries. After the first refusal the Shopper is told, by notification or text, in words that never give an amount: "a payment for your order could not be taken; please check your card or pay by bank transfer". The owner has it on Ozi's desk. If the bank asks the Shopper to check it is really them, no more tries are made, because only the Shopper can do that; they are sent a secure link from our payment company to pay instead. Paying a family plan member's order is done when it is sent, so this choice is not offered on a family plan.
- **By bank transfer before the day.** The checkout shows our account name, sort code and account number and the order's own reference, to pay by the day before delivery. Staff mark it received in the Payments tab, as for every bank transfer order.

If an order is still not paid when its Runner would be sent, no Runner is sent. The Shopper and the owner are told, and the order waits. The Shopper can still pay, or cancel it.

## Pay us by bank

A new page, "Pay us by bank", shows our account details and a reference of the account's own, with plain steps for setting up a transfer or a standing order in their own banking app. Shoppers reach it from More; Shop Partners and organisations, who pay monthly fees, from their dashboards. Runners do not pay us, so they never see it, and the server refuses to show it to a Runner. The account number and sort code are never written to a log.

## What the Shopper agrees to

Before the one yes, the screen shows, and Ozi says, the day and the time of day; when the money is taken, whether now, on a day at a time, or by bank transfer by a day; and that the final amount is what the till says on the day. If prices have gone up by then, the difference is taken from the saved card on the day, or added to what is paid by bank transfer; if they have gone down, the difference is given back. This uses the till settlement that already exists, so nothing new decides an amount.

Those words are the words agreed to, kept on the order. The server refuses a booking whose words do not name its day. Rule One holds: one yes covers the whole agreement, and nothing is taken that was not agreed. Rule Four is unchanged: nothing about the price depends on the day or the time. The monthly allowance counts a booked order in the month it is delivered in.

## Reminders

The Shopper is told when the order is booked, the evening before (at 18:00), on the morning of delivery (at 07:30), and when the payment is taken or could not be taken. Texts never carry an amount.

The owner has one matter on Ozi's desk each morning (at 07:00) listing how many orders are booked for the day and in which windows, rather than one matter for each. A payment that could not be taken is a matter of its own.

Runners see "Booked for tomorrow" on their home page: how many orders, by time of day, and nothing about who, where or what. Those come only with an offer, on the day, like any job.

## Changing and cancelling

Booked orders appear at the top of Past orders, under "Booked for later", with the day, what is in them, the total, and when the money is taken. The Shopper can change the day and the time of day until a Runner is sent, and the day and time the money is taken until it has been taken. They can cancel until a Runner has it. Cancelling after paying by card gives everything back to the card in full; after paying by bank transfer, a person sends it back and the owner is told; before paying, nothing was taken.

## Settings

All in `scheduled` in config/store.json, checked by the configuration parser: `maxDaysAhead` 28, `offerLeadMinutes` 90, `defaultChargeTime` 00:05, `retryEveryMinutes` 60, `maxChargeTries` 6, the three windows, and the reminder times `dayBeforeAt` 18:00, `morningOfAt` 07:30 and `ownerSummaryAt` 07:00.

## Still to do

"Repeat this order every week" would fit naturally on top of the weekly shop, but it is not part of this change, to keep it small.
