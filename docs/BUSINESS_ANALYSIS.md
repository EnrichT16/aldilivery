Business analysis at Ozi Delivery

Written for Anthony, 7 October 2026: "start gathering the data, in a simple, medium and complex way, that does not break the law", to understand Shoppers, Runners, Shop Partners and organisations, cross-reference them, and later sell insight to companies, organisations and government.


The rule that keeps it lawful

UK GDPR and the Data Protection Act 2018 allow this, on three conditions, and the app is built to meet all three:
1. No names, telephone numbers, email or street addresses in the analysis records. People appear only as a one-way code, made with a server secret, that cannot be turned back into a name. Places appear only as postcode districts (such as ME7), never a full postcode or a street.
2. Nothing about one person is ever shown or sold. Every figure covers at least ten different people (rulings 13, 14 and 16). Smaller groups are left out of every table, on the screen and in downloads.
3. People are told, in plain words, on the privacy page; the age group is optional and can be taken away in Settings; and anyone can ask to be left out.

Never collected for analysis: health, disability, religion, ethnicity, exact location or journeys, voice recordings, card details. Even "what a blind person buys" is health-related, so it is never a group of its own.

What we sell is figures about groups (insight), never data about people. Selling or sharing anything about an identifiable person would need their explicit consent, and is not planned.


What is collected now (simple), from day one

Every purchase, once per shop it came from, partner or not:
- which shop, and when (to the second);
- the postcode district it went to;
- how many items, how much shopping, and what kinds of things (the catalogue categories);
- the Shopper's code, and their age group if they gave one;
- whether it came through an organisation;
- the Runner's code and how they travelled (on foot, bicycle, car).

Every delivery: the same, so each "shop to area" route can be counted.

Every search: what was searched for, and whether anything was found. "Wanted, but nobody has it" is the most valuable list for shops.

Every Spotlight mention, for the shop's own report.

The founder and the business analyst see it in the admin panel's Analytics tab, by the last second, minute, hour, 4 hours, day, week, month and year; by shop, age group, area, kind of thing, hour of the day and day of the week; Runner routes and travel; top searches; and unmet searches. It downloads as a spreadsheet. Ozi reads it aloud ("read me the analytics").

Shop Partners see their own figures: purchases from their shop this week and this month.


Medium, next (when there are a few thousand orders)

- Repeat and loyalty: how often the same code buys again, by shop and area (cohorts).
- Basket analysis: which things are bought together (for Recipes, Little Gifts and shop offers).
- Busy times by area, to tell Runners when and where to be on shift.
- Shop "share of wallet": of the people who use a shop, how much of their shopping it gets.
- Organisation reports: spending per person supported, on time, compared with the organisation's own staff-trip cost.
- Unmet demand by area, sent to Shop Partners as a monthly tip ("12 people near ME7 looked for gluten-free bread").


Complex, later (tens of thousands of orders)

- Forecasting demand by area, day and hour (time-series models), to plan Runners and stock.
- Price sensitivity: how buying changes when a price changes.
- Route efficiency: grouping deliveries, matching where Runners live with where orders are.
- Cross-referencing the four sides: Shoppers' areas and times against Runners' routes and Shop Partners' stock, to say where a new Shop Partner or more Runners are most needed.
- An "Ozi Local Index": a monthly public report of what local people need, by area, for councils and the press.


What can be sold (insight, never people)

1. Shop Partner Insights, an add-on: their customers by age group and area, busy times, what their customers look for that they do not stock. Suggested £9.99 a month, or included in Spotlight Plus.
2. Organisation reports: for councils, housing and care providers, the shopping needs of the people they support, by area, with savings against staff trips. Part of a contract.
3. Local market reports: for brands, wholesalers and new shops, demand by postcode district and category. Sold per report.
4. Government and research: the Ozi Local Index, and commissioned studies (food access, isolation, "food deserts"), always about groups of at least ten.

Each sale is of figures that cover at least ten people, signed off by the founder.


Where it is stored

The AnalyticsEvent table, separate from the tables the service runs on. At volume it moves to its own analytics database (docs/GROWTH_PLAN.md, step 3), so reports never slow down orders. Records are kept for seven years, like money records, then deleted.
