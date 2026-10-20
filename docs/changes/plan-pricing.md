# New plan prices and the monthly order allowance (ruling 73)

Anthony decided on 20 October 2026 to change what delivery costs on each plan, to give every monthly plan a monthly order allowance, to give Ozi Plus a second free Ozi Finds It, and to make the item charge a rule that can never be changed. Every figure lives in `config/store.json`; nothing below is written into the code.

## Delivery

Delivery is still priced by the plan and by the value of the shopping at the shop's prices, in three bands.

Paying as you go, with no plan and during the free first month, delivery is £10.99 for shopping up to £30, £12.99 for shopping over £30 up to £60, and £14.99 for shopping over £60.

Ozi Membership, at £10 a month, and the people an organisation looks after, pay £7.99 up to £60 and £9.99 over £60.

Ozi Plus, at £15 a month, and Ozi Family and Carer, at £20 a month, pay £6.99 up to £60 and £8.99 over £60.

The monthly prices are unchanged, and so are the organisation prices: £10 a client a month, with every 51st client half price. Each further order of a basket over £150 still costs £13.50 for its Runner.

## The monthly order allowance

Every monthly plan includes a number of the Shopper's own orders in each calendar month, counted in UK time. Ozi Membership includes 5. Ozi Plus includes 8. Ozi Family and Carer includes 5 for each person on the plan, counted separately for each of them. The people an organisation looks after have Membership delivery, so they have 5. Paying as you go has no allowance, and never has an extra charge.

The order after the allowance has an extra delivery charge of £5.99. The next two orders do not, then the one after has it again, and so on. On Membership that means the 6th, 9th, 12th and 15th orders of the month; on Plus the 9th, 12th and 15th. In the code, order number n of the month carries the extra when n is more than the allowance and n minus the allowance minus one divides exactly by three.

An order counts when it is one of the Shopper's own whole orders that was paid in the current month and has not been cancelled or refunded. A part of a split job is not an order of its own, and a basket kept whole as several linked orders counts once. The order being placed counts as the next number. No new information is stored to count them: the count is worked out from the orders already there.

## Telling the Shopper

Nobody is ever charged the extra without being told first. Before the one yes, the basket, the confirmation screen and Ozi's spoken read-back say, for example: "This is your 6th order this month. Your plan includes 5, so this one has an extra £5.99 delivery charge." The telephone line reads the same words back before asking whether to send the order, and the notice before a regular order that sends itself says so too. On the last order a plan includes, Ozi gives a gentle heads-up that later orders this month may have the extra.

The charge appears as its own line, "Extra delivery charge", on the basket, the confirmation screen and the receipt, and it is included in the total charged. It is kept on the order so the receipt can show it. Like delivery, it is not part of the shopping: the till only ever changes the shopping, the settlement of the till and any refunds work as before, and the extra goes to the business. The Runner's pay does not change: five pounds, or seven pounds for an order of £120 or more delivered whole.

## Ozi Finds It

Membership and the free month include one free Ozi Finds It a month. Ozi Plus and Ozi Family and Carer now include two.

## The item charge

The item charge is a foundational rule and may never be adjusted: 50p, plus 50p for every whole £6 of the product's shop price, on every unit, on every plan. Its behaviour has not changed.

## Worked examples

A Member's 6th order of the month, £25 of shopping made of ten things each under £6, costs £25.00 for the shopping, £5.00 of item charges, £7.99 delivery and the £5.99 extra delivery charge: £43.98 altogether.

Mary's milk, bread and eggs, £4.69 of shopping with £1.50 of item charges, paying as she goes, costs £4.69 plus £1.50 plus £10.99 delivery: £17.18.

John's £58.36 shop of ten products, with £8.50 of item charges, costs £79.85 paying as he goes, £74.85 as a Member and £73.85 on Plus.

## Where it shows

The plans page lists each plan's monthly price, its delivery, its monthly allowance with the extra charge, and its free Finds It searches. The terms, About, Just looking, Looking after someone, the Finds It page, the free-month reminder, the organisation dashboard and Ozi's phrases all read the new figures from the settings.
