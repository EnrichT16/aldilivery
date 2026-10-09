# Ozi Delivery — Master Blueprint (current truth)

Consolidated on 7 October 2026 from docs/BUILD_PROMPT.md (Sections A to S, Section T, Anthony's
answers of 30 September, and rulings 1 to 49), RULES.md, LAUNCH.md, DEPLOY.md, every file in
docs/, config/store.json and config/adverts.json, and a check of the code itself.

Where earlier text was later overruled, only the current position is given here. A short list of
what was overruled is in Part 5. docs/BUILD_PROMPT.md remains the detailed history, with every
ruling word for word and the reasons behind them; if this document and BUILD_PROMPT.md ever
disagree, BUILD_PROMPT.md's latest ruling wins, and this document should be corrected.

A note on numbering. BUILD_PROMPT.md has two short runs that each start at 1: the rulings of
1 October (1 to 3) and the rulings of 2 October, which start again at 1 and then carry on to 49.
In this document "ruling N" means the main run (2 October onwards). The first run is written
"1 October ruling N".

Ruling 55 (9 October 2026) has Runners paid back for the shopping straight away, renames the
order button "Send my order and pay", and records each Runner's agreement to the Runner agreement
before their first job; it is summarised at the end of this document.

Ruling 50 (7 October 2026) adds paying by bank transfer to the business account, the website's
own pages, a "Get the app" button and social media links; it is summarised in Part 4 and Part 5.

Status words used in Part 4:
- **BUILT**: in the code and working, even if it still needs a key or setting switched on.
- **PARTLY BUILT**: some of it is in the code; what is missing is said.
- **NOT BUILT**: nothing, or only a placeholder.

---

## Part 1. What Ozi Delivery is

**In one sentence.** Ozi Delivery is a voice-first shopping and delivery service for the UK: a
Shopper tells Ozi what they want, an independent Runner buys it at the shop and brings it to the
door, for one flat delivery fee.

**Who it is for.** Blind, partially sighted and elderly people first, and then anyone else.
Every decision is judged by whether it works for someone who cannot see the screen.
Accessibility is not a later pass; it is the product. The owner, Anthony Tochukwu Ibe, is
registered blind, and runs the business through the admin panel, by voice and screen reader.

**The name.** Ozi is Igbo for "message". The product's earlier name is retired and must not
appear anywhere (Section A). The words used on every screen are **Shopper** (never customer,
user or client) and **Runner** (never driver or courier).

**The motto.** "Send me, I will help." Ozi says it when it introduces itself, and it is on the
first screen (ruling 19). The tagline in configuration is "Say it, Ozi shops it, a Runner brings
it".

**Ozi, the assistant.** Ozi speaks first, aloud, from the first launch: "Hello, I'm Ozi, your
shopping assistant. Send me, I will help." (ruling 20). It holds a back-and-forth conversation,
takes whole orders by voice, repeats itself when asked, and explains itself.

**The brand.** Navy (#0B1F3A), gold (#D4AF37) and white, with a bright green (#2FBF71) for Ozi's
listening button. Premium, calm, smooth: no sudden movement or layout jumps, large text and
controls, every icon with its words written under it (a plus sign reads ADD AN ADDRESS). The
brand, names and colours are configuration in config/store.json, never code (Rule Nine).

**Where.** ozidelivery.co.uk. Medway first (Gillingham, ME7, for the soft launch). The service is
online only, anywhere in the UK; nobody visits an office (ruling 10).

**Who runs it.** Tofadachi AI and IT Solutions UK Ltd (the company number, registered office and ICO number are still placeholders, see Part 7).
Owner and founder: Anthony Tochukwu Ibe.

---

## Part 2. Accounts and who sees what

Each kind of account has its own sign-in, and Ozi has each dashboard's own commands and phrases
only, so it never mixes them up (rulings 41, 44). A key for one kind of account never opens
another. All of this is checked by the server on every request.

| Account | How they sign in | What they see and do |
| --- | --- | --- |
| **Shopper** | Mobile or landline number and a one-time code (text to a mobile, an automatic phone call to a landline). Can be done entirely by voice (rulings 24, 27, 47). No password. | Shop, basket, orders, live order page, saved cards (last four digits only) and addresses, Settings (voice, words on screen, organisation link, age group, share link, sign out). Their own orders only. |
| **Runner** | Phone number and code; registers entirely in the app (ruling 2 Oct 2). | Their Runner page: today, shift on and off, job offers (pay and distance first), the current job (list and drop-off), money (earned, owed, paid out), Training tab, their Runner ID and share link, documents, feedback. Sees an order reference and the area only, never the Shopper's name or number. |
| **Shop Partner** | Username and password given by our partnerships staff (business sign-in at /business). | Its own products (add with a photo, change price, take off), what it pays and its payment history, PDF statements, its share link and meter, its own purchase figures. Never who bought. |
| **Organisation** (councils, care homes, hospitals, charities, businesses) | Username and password per person, each with their office (/business). | Only the people who chose to link to it with its code: their orders, spending this month, last month and in total, by office, budget left, savings against its own staff-trip cost, weekly shops booked, statements as PDF and spreadsheet, share link and meter. |
| **"I look after someone"** (family and carer plan, T1) | A door on the first screen. | NOT BUILT: the page says "coming soon". |
| **Call guest** | A one-off link sent by the Shopper during a call (MERGE). | Joins that one call only. |
| **Staff** | /staff, username and a password they choose at first sign-in (hashed; five wrong tries waits fifteen minutes) (ruling 38). | Only the tabs for their job (below). Every decision records their name. |
| **Owner** (Anthony) | /staff, username, password and a 7-character passcode (six numbers then a special character), plus optional authenticator-app codes (ruling 43). | Everything, and the only account that sees the money. Manages the team, family and investor views, and the kill switch. Ozi calls him "Mr Anthony" and "sir" (ruling 44). |
| **Family** (such as Anthony's wife) and **investors** | Their own sign-in, made by the owner. | Read only. Everything starts switched off; the owner switches parts on one by one or all at once: overview, business analysis, the team, documents, complaints, feedback, Finds It, enquiries, shops and organisations. Never the money. |

**Staff jobs** (ruling 38; docs/STAFF_ROLES.md is the hiring guide; set in
packages/api/src/lib/staff.ts):

| Job | Tabs |
| --- | --- |
| Founder | Everything, including the Team. The only one who manages staff. |
| Operations manager | Documents, Problems, Feedback, Finds It, Enquiries, Shops and organisations, Learning. Not Money owed, not the Team. |
| Runner onboarding officer | Documents. |
| Customer care officer | Problems, Feedback, Learning. |
| Finance officer | Money owed. |
| Finds It shopper | Finds It. |
| Partnerships officer | Enquiries, Shops and organisations. |

The **Business analyst** job was withdrawn (ruling 43): business analysis belongs to the founder
and to whoever he switches it on for. The **STAFF_API_KEY** signs in as the founder; it is for
emergencies and for making the first owner account, and it never sees the money (ruling 43).

The admin panel tabs are: Overview, Money (owner only), Documents, Problems, Money owed, Finds It,
Enquiries, Shops and organisations, Analytics, Feedback, Learning, Team, My settings.

---

## Part 3. Prices and money

### Current figures

All figures are in config/store.json, held in pence and converted here. The owner can change
them there; tests pin the core ones so a change is made on purpose.

| What | Price | Set by |
| --- | --- | --- |
| Standard delivery, flat | **£13.50** | Section B, Anthony's answer 1 (30 Sept), Rule Three |
| Runner's share of every standard delivery | **£5.00**, untouched, whatever the basket | Section B, Rule Two |
| Maximum shopping in one delivery | **£60.00**. Above it Ozi says so and offers two deliveries | Section B, Rule Three |
| Most that can be confirmed by voice alone | **£80.00** (above it, touch confirmation) | Section E (setting, default £80) |
| In-app calls | **5p a minute**, paid by the Shopper; a Runner never pays | Section B, rulings 2 Oct 1 and 16 |
| Outstanding call balance before more people can be added to a call | **£10.00** | Ruling 16 |
| Ozi Recipes, the Recipe Pass | **£1.99 for 30 days**, never renews by itself | Ruling 36 |
| Ozi Plus | **£7.99 for 30 days**, never renews by itself; includes Recipes and the Finds It fee | Ruling 37 |
| Ozi Plus for a family | **£11.99 for 30 days**, up to 4 people, joined with a six-letter family code | Ruling 37 |
| Ozi Finds It | **£2.00**, up to 3 shops looked in, given back if nothing is found | Ruling 37 |
| Gift cards | **£10, £20, £30 or £50** | Ruling 37 |
| Shop Partner plan | **£29.99 a month** | Rulings 41, 42 |
| Spotlight (extra for paid-up Shop Partners) | **£19.99 a month**, mentioned at most once a week to the same Shopper | Ruling 42 |
| Spotlight Plus | **£39.99 a month**, up to three times a week | Ruling 42 |
| Cool bag deposit (Runner) | **£10.00**, built up at £1 from each of the first ten payouts, released after the 20th delivery | Section M |
| Refunded straight away, no investigation | **£5.00 or less**, never counted against a Runner | Ruling 16 |
| Recovery from a Runner found at fault | **10% of each job's pay** (50p from a £5 job) until a solicitor confirms more is lawful | Ruling 15 |
| Written off when a Runner leaves owing | **£20.00 or less**; above that they are asked to repay | Ruling 16 |
| Card processing (used for the platform's own sums only) | 1.5% plus 20p | Configuration |
| Pay-by-link for telephone orders | Link works for **23 hours**, then the order closes | Ruling 48 |

Other settings in the same file: a job offer is held for a Runner for 60 seconds; orders within
1 mile can be pooled into one trip (each still pays the Runner £5); a recurring order's notice
goes 30 minutes before, and the one word "skip" stops it; a closed account stays in a recycle
bin for 7 days; problems are decided within 2 working days.

**Prices in the blueprint that are not in the code yet** (the services are not built): extra
shop within one mile £2.50 (£1.50 Runner, £1 platform); beyond one mile £4.00 (£2.50 Runner,
£1.50 platform); business emergency run £12 flat in Medway (£8 Runner, £4 platform, 45-minute
promise); errands £13.50 for up to 30 minutes (£5 Runner), then £6 per 15 minutes (£4 Runner);
sending £13.50 (£5 Runner); handed to the person £2 (all to the Runner); Ozi Line £15 for 75
minutes, £25 for 180, £35 for 300, 12p a minute beyond; family and carer plan £3.99 a month per
Shopper looked after, up to three family members (T1); bundles of four deliveries for £48 (T3);
referral reward £150 (ruling 16). Campus is ordinary Shopping with a different payer: £13.50 plus
goods, no new price (Section J).

### Payment rules

- **No card, no order** (ruling 29, hard rule). Nobody orders in the app, on the website, by
  voice or by telephone without a valid card saved with the payment gateway, never with Ozi.
  Payment is taken before a Runner is sent. No paying at the door, no trial order. Someone who
  cannot enter a card has a family member, carer or someone they trust enter it for them.
- **One explicit yes** before any payment (Rule One). Ozi reads the list back and hears a yes;
  no PIN is needed to order (ruling 26). Over £80, the yes must be a touch. The one button that
  places an order reads **Send my order and pay**, and Ozi asks "Shall I send your order and pay
  now…?" (ruling 55, so the button says plainly that it means paying, as the Consumer Contracts
  Regulations 2013, regulation 14(3), ask).
- **Stripe** takes the cards. Card numbers never reach Ozi (Rule Ten); only Stripe's identifier
  and the last four digits are stored. Apple Pay, Google Pay and Stripe Link come through Stripe
  (ruling 35). Cards from any country are accepted (ruling 18; configuration says "ANY").
  Flutterwave, Paystack and mobile money are wanted but not built (rulings 17, 18, 35).
- **Pay by a texted link** (ruling 48). A telephone caller from a mobile with no account, or no
  card or address, can order: Ozi reads it back, and after a yes texts a secure Stripe link
  where they pay and give the delivery address. Nothing is sent to the shop until it is paid. A
  landline caller with no account is sent to the website. A card is never spoken to Ozi or to
  anybody on a call.
- **The till total.** Catalogue prices are estimates. The Runner types the total from the till
  receipt, the order is repriced to it with the same flat fee, and the Shopper is told. The
  promise is that the Shopper pays what the till said, with the goods and the fee kept as
  separate amounts throughout (Section R, for VAT). BUILT (ruling 52): the difference from what
  was charged up front is settled on the same card at once; less goes back, more is taken up to
  the larger of £5 or a fifth of the estimate, and anything larger waits for a person. The till
  total goes in once only; a mistake in it is put right by a person.
- **Runners pay at the till with their own card and are paid back straight away** (ruling 55,
  "choice 1"). BUILT. When the till total goes in, the Runner is paid back that total by Stripe
  Connect transfer to their own account, with the reference `reimburse:<order id>` so it can
  never go twice, and told "You've been paid back £X for the shopping." Their £5 follows at
  delivery, and is then said together: "You've been paid back £X for the shopping and £5.00 for
  the delivery." Only an accepted till total is paid back without a person: no more than the
  estimate plus the larger of £5 or a fifth, never more than £60 (Rule Three). When the till
  needs a person, so does the pay-back: it waits in the admin panel's Payments tab with an
  Approve button (founder and finance officer), and the owner is texted. A Runner whose payout
  account is not ready is owed it, shown it, and paid by the minute sweep once it is. Recorded
  on the order; shown on the Runner's Money tab and in the owner's Money page.
- **Refunds** (rulings 7, 8, 16). A Shopper or Runner reports a problem with voice notes,
  writing, photos or video. Ozi acknowledges at once. £5 or less is refunded straight away.
  Otherwise staff decide within 2 working days (5 at most), and the refund goes back to the card
  the same day. Who pays: the platform refunds the Shopper first; if the Runner was at fault, 10%
  of each later job's pay is recovered until repaid, only after a written staff decision the
  Runner can answer; nothing is ever deducted automatically; if the Shopper was at fault, no
  refund; if the platform or shop, the platform bears it. The owner hears money going out as
  falling coins and money taken as a till's "ka-ching".
- **Call charges** (rulings 2 Oct 1, 16, 46). The Shopper pays 5p a minute in an ordinary call.
  Whoever adds people to a call (MERGE) pays for their own minutes and every person they added,
  and Ozi says the price and waits for a yes before adding anyone. If the card cannot be charged,
  the amount is kept as an outstanding balance and taken next time; above £10 it must be paid
  before more people are added. "Ring their phone instead" costs the Shopper nothing. A Runner
  never pays for a call.
- **Runner pay** (Rule Two, Section M, rulings 15, 16). £5 per standard delivery, untouched;
  extras (another shop, handing to the person, tips) are paid on top, never out of it. Money goes
  straight to the Runner's own Stripe Connect account; Ozi never holds it (Rule Ten). The cool bag
  deposit is held back from early payouts, never from the £5 (docs/LEGAL_REVIEW.md notes that
  while it is held, the service does hold some Runner money, against Rule Ten's wording; left
  as it is, for Anthony to rule on). Paying back the shopping (above) is the Runner's own money
  and is never counted as pay. Weekly payouts by default, daily
  or instant at the Runner's choice, are ruled (ruling 16) but NOT BUILT: today each delivered job
  is paid by transfer, with a sweep every minute for any that could not be paid at once.
- **Tipping** (Section B): optional, all to the Runner, at checkout and for an hour after, no
  suggested amount, and Ozi never asks for a tip aloud. NOT BUILT.
- **VAT** is not settled (Section R). Goods and the Ozi fee are recorded separately so either
  treatment can be applied. Nothing is hard-coded.
- **The owner's ledger** (ruling 43). Every payment in and refund out is recorded by gateway as it
  happens, and seen only by the owner.

---

## Part 4. Every feature, and whether it is built

### Ordering

| Feature | Status | Notes |
| --- | --- | --- |
| Shop, search and basket by touch | BUILT | Catalogue of everyday groceries with estimated prices; flat fee and £60 cap enforced. |
| Whole order by voice | BUILT | Ozi asks quantities, reads the basket and total back, then the address, then takes a yes (Section E). |
| Spoken address before every order | BUILT | The real address, not "your usual" (Section D). |
| Voice orders go to the home address only | BUILT | Enforced by the server (Section D). |
| £80 voice ceiling | BUILT | In the app and on the telephone. |
| Saved addresses, unlimited, PIN to save; one-off address by touch | BUILT | See the contradiction with ruling 26 in Part 5. |
| PIN: typed, spoken or tapped; obvious PINs refused; three tries then a wait; notice when the home address changes | BUILT | Tapped PIN (ruling 25) with buzzes; iPhone browsers cannot buzz, Ozi says so. |
| Concurrent ordering while a job is active | BUILT | Section G. |
| "Same as last time" and "Order these again" | BUILT | Puts the last order back in the basket to change first (ruling 36). |
| Weekly shop | BUILT | A day of the week; Ozi offers the usual shopping that day; nothing is sent or paid without a yes (ruling 37). |
| Scheduled and recurring orders (Sets) with the 30-minute notice and "skip" | PARTLY BUILT | The rules are in the code and tested (Rule Five), but nothing runs them on a clock and the notices are not sent; one-off orders for a future time are not built (Section I). |
| Live order page | PARTLY BUILT | Stage, the Runner's first name, questions and the call button. No estimated arrival time; Ozi does not say each stage aloud on the page (Section G). |
| Substitutions | PARTLY BUILT | The Runner asks "cannot find it" in one tap; the Shopper answers on screen or in a call; the outcome is recorded per line. Missing: a call started from the prompt in one tap, and refunding unbought items through the till total (Section H). |
| Receipts read aloud (T10) | NOT BUILT | |
| Door safe word (T6) | NOT BUILT | Training title only. |
| Errands, Sending, Business emergency runs (Sections C, K) | NOT BUILT | Only Shopping exists. Campus works as Shopping to a second address. |
| Extra shop fees, nearer-shop saving, tipping, handed to the person (Sections B, L) | NOT BUILT | |
| Several shops with prices dated (Section N, ruling 16) | PARTLY BUILT | One configured store catalogue plus Shop Partner pages. No price dates, no OpenStreetMap shops, no Open Food Facts prices. |
| Region selector and marketplace switching (Section P) | NOT BUILT | |

### Ozi, its phrases, learning and banned words

| Feature | Status | Notes |
| --- | --- | --- |
| Ozi speaks and hears through Oluoma Voice; the phone's own speech as the fallback | BUILT | Ruling 53. packages/web/src/voice/oluoma-engine.ts behind the interface in engine.ts (docs/OLUOMA_VOICE.md); GET /voice/session gives the app a five-minute token, never the key. On when OLUOMA_VOICE_URL and OLUOMA_VOICE_KEY are set; the phone's own speech otherwise, and the moment the engine fails. The telephone line still uses Polly until the Oluoma phone bridge. |
| Ozi speaks first; "Tap anywhere" on the website | BUILT | Rulings 3 (1 Oct), 20. |
| Round green button: glows while listening, moveable by drag or arrow keys, "Muted" not by colour alone, gentle reminders while muted (2 min, then 3, then every 3) | BUILT | 1 October ruling 3. |
| Talking switch at the bottom of every screen; "turn off talking"; Settings | BUILT | Ruling 21. |
| "Repeat", "pardon" and the like, worded differently, then "Did you hear that?" | BUILT | Ruling 22. |
| Phone numbers said in twos, twice, offered a third time | BUILT | Ruling 23. |
| Create an account or sign in by voice; "finish my account"; straight into the shop when signed in | BUILT | Rulings 24, 47. |
| First-launch "do you need extra help?", pinch to zoom | BUILT | Ruling 47. |
| "Sign me out", "change account", Sign out button | BUILT | Rulings 27, 32. |
| Two or three output voices per language in Settings | PARTLY BUILT | Lists the phone's own voices. |
| Ozi mentions its own features from time to time (Section E) | NOT BUILT | |
| Welsh, then Igbo, Hausa, Yoruba, Swahili (Section E) | NOT BUILT | The voice interface takes a language; the screens are English only. |
| "Hey Ozi" wake word while muted | NOT BUILT | Needs Oluoma Voice and the phone apps; the browser cannot. |
| Phrases for every account, kept on the server | BUILT | At least 400 each (ruling 49): Shoppers in config/ozi-phrases.json; Runners, Shop Partners, organisations, staff, family, investors and the owner in config/phrases/. The owner's Ozi has everybody's. The app asks POST /ozi/reply; which collection answers depends on who is signed in. |
| Phrase found inside a longer sentence, or by meaning words | BUILT | Ruling 49. |
| One-way fingerprints in the app; 2.5-second limit | BUILT | Ruling 49. |
| Learning list (what Ozi could not answer, most asked first, approved by a person) | BUILT | Learning tab for founder, operations manager and customer care. |
| Banned words (config/banned-words.json), found however disguised; nothing personal kept | BUILT | Ruling 49. |
| Daily phrases routine | BUILT (outside the code) | See Part 6. |

### Telephone ordering

| Feature | Status | Notes |
| --- | --- | --- |
| Ozi answers the Twilio number, finds the account by the caller's number, takes the order item by item, reads it back slowly with the fee, total, card's last four and home address, sends after a yes | BUILT | Rulings 28, 46. Needs Twilio switched on (Part 7). |
| Ask to keep a stranger's number; ring back once if cut off | BUILT | Ruling 46. |
| Callers with no account or card: pay by a texted Stripe link (mobile); landline sent to the website | BUILT | Ruling 48. |
| Texts to the number answered with how to order | BUILT | |
| Every Twilio request checked by its signature | BUILT | |
| Card on the phone keypad (Twilio Pay with Stripe) | NOT BUILT | Ruling 46: needs Twilio Pay connected first. |
| Ozi Line minute packages (Section B) | NOT BUILT | See Part 5. |

### Calls (LiveKit)

| Feature | Status | Notes |
| --- | --- | --- |
| In-app calls between Shopper and Runner, big green button on both sides | BUILT | Hidden until the LiveKit keys are set. |
| End, mute, loudspeaker, MERGE (carer joins by a link, price said first) | BUILT | |
| Minutes counted per call and person; 5p a minute; outstanding balance | BUILT | |
| "Ring their phone instead" for a Shopper with no app, number never shown | BUILT | Needs the SIP trunk (docs/TWILIO_AND_LIVEKIT.md). |
| Native ringing on a locked phone (CallKit, ConnectionService), "Hey Siri, pick up" | NOT BUILT | Needs the phone apps (waiting on the D-U-N-S number). |

### Notifications and texts

| Feature | Status | Notes |
| --- | --- | --- |
| Web Push at each stage (paid, Runner has it, on the way, delivered) and for a Runner's question | BUILT | Needs the VAPID keys. |
| A text instead, for a Shopper with no notifications and a mobile | BUILT | Ruling 46. |
| Sign-in codes by text, or a phone call that speaks them to a landline | BUILT | Ruling 27. |
| Text to the Shopper when the home address changes | BUILT | Section D. |
| Email sign-up with an emailed code | NOT BUILT | Ruling 33. |
| Weekly spoken summary (T7) | NOT BUILT | |

### Extras and ways to earn

| Feature | Status | Notes |
| --- | --- | --- |
| Ozi Plus and Plus for a family | BUILT | Ruling 37. Never changes the delivery fee. |
| Ozi Recipes (Recipe Pass); recipes read aloud | BUILT | config/recipes.json. Names and ingredients free to see. |
| Little Gifts | BUILT | config/gifts.json; never alcohol. |
| Ozi Finds It, with "Found for you" in the catalogue | BUILT | Never alcohol, tobacco, medicines, cash or anything age restricted. |
| Gift cards (twelve-character code, used once, credit returned to the card) | BUILT | |
| Offers (only agreed in writing, config/offers.json, empty today) | BUILT | |
| Everyday essentials the same day | BUILT | A search link to essentials in the shop. |
| Enquiry form for shops and organisations, landing in the admin panel | BUILT | |
| Shop Partners: own sign-in, products with photos, checked by a person, statements, payment history | BUILT | Ruling 41. Plan and Spotlight payments are recorded by staff when a shop is set up or renewed (months paid); they are not collected through Stripe automatically. |
| Spotlight and Spotlight Plus | BUILT | After the genuine results, called an advert, checkable facts only, weekly limits (Section O, ruling 42). |
| Organisation dashboards, statements as PDF and spreadsheet | BUILT | Ruling 41. Paying by invoice is not built and needs Anthony's ruling. |
| Advert square | BUILT, switched off | Small, in a corner, never on paying or card screens, never read aloud, hideable for Plus members; on when config/adverts.json says enabled (ruling 43). |
| Share links and meters for everybody | BUILT | Shoppers in Settings, Runners, Shop Partners, organisations, staff, family, investors and the owner (rulings 11, 42, 44). |
| Private referral reward (£150 for 100 paying referrals, with anti-cheating guards) | NOT BUILT | Runner IDs and share counts exist; the reward and its database do not (rulings 12, 16). |
| Family and carer plan (T1), bundles (T3), sheltered housing rounds (T5), wellbeing check (T8) | NOT BUILT | Pooling of nearby orders exists and is the start of T5. |
| Council invoicing and commissioner reports (T2) | PARTLY BUILT | Organisation dashboards and statements exist; invoicing does not. |

### Runners

| Feature | Status | Notes |
| --- | --- | --- |
| Sign-up in the app: phone and code, every way they might deliver, face photo, right to work, DBS, licence and insurance for car or motorbike, bank details on Stripe's pages | BUILT | DVLA check code and automatic MOT and tax checks are not built. |
| Staff check documents before any job is offered (right to work and basic DBS required) | BUILT | Enhanced DBS for T5, T8 and handovers not built. |
| Switching how they deliver; car or motorbike blocked without accepted insurance | BUILT | Insurance expiry reminders not built. |
| Agreeing to the Runner agreement before the first job: a tick at sign-up or on the Runner page (a spoken yes is accepted by the server), kept with the date, version and how | BUILT | Ruling 55. No job is offered or accepted until the current version is agreed. |
| Paid back for the shopping straight away when the till total goes in | BUILT | Ruling 55. A person approves the ones the till needs a person for. No receipt photo is taken yet. |
| Fair job offers with pay and distance, 60-second hold | BUILT | |
| Dashboard: earned (big and bold), job history by reference and area, payouts, owing | BUILT | |
| Runner ID, share link, feedback page | BUILT | |
| Report a problem per job with voice notes, photos, video | BUILT | |
| Training tab | PARTLY BUILT | Module titles only (T11). |
| SOS button sharing live location | NOT BUILT | Section M. |
| Navigation to the shop and the door | NOT BUILT | Section M. |
| Working offline and syncing evidence later | NOT BUILT | Section M. |
| Handed to the person: first name and a geotagged photo sent at the moment of capture | NOT BUILT | Section L. |
| Payout schedule (weekly default, daily, instant) | NOT BUILT | Ruling 16. |

### Admin panel and the owner

| Feature | Status | Notes |
| --- | --- | --- |
| Staff accounts by job, each with only their tabs; instant turn-off | BUILT | Ruling 38. |
| Owner account: passcode, authenticator codes, money, ledger, family and investor views, kill switch | BUILT | Ruling 43. |
| Ozi speaks to staff everywhere: greets by name with what is waiting, reads lists with next, back, again, decides by voice after a yes | BUILT | Ruling 39. "Mr Anthony" and "sir" for the owner (ruling 44). |
| Voice questions: overview, money (owner), analytics | PARTLY BUILT | Section Q asks also for signups by period, cancellations, refunds yesterday and why, and Runners active now as spoken answers; some are only on screen or not at all. |
| Documents, Problems (with deadlines), Money owed, Finds It, Enquiries, Shops and organisations, Feedback (Runners'), Learning, Team | BUILT | |
| Analytics tab: purchases, deliveries, searches and unmet searches by period, shop, area, age group; groups under ten hidden; spreadsheet download | BUILT | Ruling 42; docs/BUSINESS_ANALYSIS.md. |
| Live and past orders across services; Runners active and their earnings; price freshness; signups by period; cancellations with reasons | NOT BUILT | Section Q. |
| Owner-only: open a Shopper's account, change pricing, refunds above a threshold, export data | NOT BUILT | Section Q. Pricing is changed in config/store.json. |
| Audit log of every admin action, immutable, owner only | NOT BUILT | Decisions record who made them; a full log does not exist (Section Q). |
| Two-step codes for every admin login | PARTLY BUILT | The owner only (Section Q, ruling 44). |

### Shopper feedback and demand

| Feature | Status | Notes |
| --- | --- | --- |
| Feedback after delivery, delivery credit for any feedback, shops see patterns only | NOT BUILT | Section O. |
| Unmet demand (every search nobody can serve) | BUILT | Kept in the analysis records with no names. |

### Accessibility, Braille and tidy screens

| Feature | Status | Notes |
| --- | --- | --- |
| WCAG 2.2 AA, axe on every screen, jsx-a11y lint | BUILT | Any violation fails the build (Rule Seven). Base text 20px, controls at least 48px. |
| Every icon with words under it | BUILT | |
| Tidy screens: descriptive words kept for screen readers, shown when "Show words on the screen" is on | BUILT | Ruling 47. Prices, totals and errors always shown. |
| Pinch to zoom | BUILT on the website | Phone apps not built. |
| Braille display through VoiceOver or TalkBack | Works today | The short tested guide is not written (ruling 40, step 1). |
| Deafblind mode, Braille connector, Ozi's Braille pad, own Braille device | NOT BUILT | Roadmap (ruling 40); nothing holds up launch. |
| Haptic alerts, Sonara device, wrist band | NOT BUILT | Roadmap only (Section S). |
| Phone apps for the App Store and Google Play | NOT BUILT | Waiting on the D-U-N-S number. |

---

## Part 5. The rules in force

### The ten inviolable rules (RULES.md)

1. A single explicit confirmation from the Shopper is required before any payment is taken.
2. The Runner receives five pounds on every standard delivery, untouched, whatever the basket.
3. Standard delivery is thirteen pounds fifty, flat, and one delivery carries at most sixty
   pounds of shopping.
4. No surge pricing, no small order fee, no minimum spend.
5. A notice is sent thirty minutes before any recurring Set order fires, with a one word skip.
6. No age restricted goods in version one (no alcohol, no identity check at any handover).
7. Every screen meets WCAG 2.2 AA.
8. Ozi Delivery shares no code, database, login or payment account with any other product.
9. Store identity, name, colours, catalogue source and legal entity are configuration, never code.
10. Ozi Delivery never stores card numbers and never holds Runner money.

RULES.md names the file and test that enforces each.

### Rulings still in force, stated once

**People and words**
- Shopper and Runner, never customer, user, client, driver or courier (Section A, ruling 16).
- Built first for people who cannot see the screen; the admin panel to the same standard
  (Sections A, Q).
- Every icon has its words under it; nothing depends on seeing a colour, a position or a small
  icon (Section A).

**Ozi's voice**
- Ozi speaks aloud by default, first, before anyone speaks to it; on the website the first touch
  lets it speak (rulings 20, 1 Oct 3).
- Two different "off" states: the talking switch makes Ozi silent but still listening, so it can
  be turned back on by voice (ruling 21); muting with the button stops listening altogether, with
  gentle reminders, and only an on-device wake word may listen while muted (1 October ruling 3).
- Ozi repeats on request, says numbers in twos, and only promises what works (rulings 22, 23).
- The voice engine is a separate product, Oluoma Voice; Ozi only calls its interface. No accent
  selector for recognition; two or three output voices per language (Section E).
- English and Welsh at launch, then Igbo, Hausa, Yoruba, Swahili; no hard-coded strings
  (Section E). Not built yet.
- Nothing said in the admin panel is ever taken as a shopping order. Passwords are typed, never
  spoken (ruling 39).
- Spoken admin answers give numbers, totals and patterns only; anything naming a person or an
  address needs the screen and an on-screen action (Section Q).

**Accounts and signing in**
- One app; the public first screen offers Shopper, Runner, organisation, Shop Partner and
  "I look after someone", with plain descriptions; staff sign in at /staff, not from the first
  screen (rulings 2 Oct 3, 16, 41, 47).
- Sign in with a phone number (mobile or landline) and a one-time code, by voice if wished;
  email as an alternative is ruled but not built (rulings 24, 27, 33, 47).
- Phone numbers are kept privately, used only to sign in and to ring back a dropped phone order,
  never shown, deleted when the account closes; a caller who never becomes a Shopper has their
  number deleted shortly after the call (ruling 31, as changed by ruling 48).
- No telephone numbers between Shoppers and Runners, ever; all contact through the app
  (Section F, rulings 30/45, 46).

**Addresses and the PIN**
- Every account has a registered home address. A voice order always delivers there
  (Section D).
- No PIN to place an order; the list is read back and a yes heard (ruling 26).
- Saving an address or changing the home address always needs the four-digit PIN, typed, said or
  tapped; obvious PINs refused; three wrong tries, then a wait; the Shopper is told every time
  the home address changes (Section D, rulings 25, 26).
- Ozi says the actual delivery address aloud before every order and waits for a yes (Section D).

**Money**
- £13.50 flat, £60 maximum shopping, £5 to the Runner, no fee bands, no surge, no minimum
  (Section B, Rules Two to Four).
- No card, no order; paid before a Runner is sent (ruling 29). Pay-by-link for telephone callers
  from a mobile (ruling 48).
- Every price is agreed by the Shopper before it is taken, and nothing renews by itself (rulings
  36, 37).
- Ozi Plus never changes the delivery fee, because a fee that depends on who the Shopper is would
  break Rule Four (ruling 37).
- Goods and fee recorded separately; VAT treatment not hard-coded (Section R).
- Calls: Shopper pays 5p a minute; whoever adds people pays for them, after hearing the price;
  £10 balance limit; Runners never pay (rulings 2 Oct 1, 16).
- Refunds and Runner recovery as set out in Part 3 (rulings 8, 15, 16).
- Cards from any country; more gateways added where their terms can be met (ruling 18).
- Tipping optional, all to the Runner, never asked for aloud, no suggested amount (Section B).

**Runners**
- Register entirely in the app; documents photographed with the phone (ruling 2 Oct 2).
- Right to work and a basic DBS check are mandatory; an enhanced DBS with the adults' barred list
  before sheltered housing rounds, wellbeing checks and handovers to the person (ruling 16).
- On foot or bicycle need no insurance; a car, motorbike or scooter needs business or
  hire-and-reward cover; switching down is instant (rulings 2 Oct 4, 9).
- Runners see an order reference and the area only (ruling 16).
- Payouts weekly by default, daily or instant at the Runner's choice and cost (ruling 16).
- A Runner may decline any sending job without reason or penalty; no Runner is expected to
  challenge a sender (Section K).
- SOS, earnings, offers with pay and distance, navigation, offline tolerance (Section M).

**Goods**
- Never carried: cash, medicines (except a signed-up pharmacy job), alcohol, tobacco, fireworks
  and Christmas crackers, flammable liquids, aerosols and gases, illegal drugs, firearms and
  weapons including replicas and knives, loose lithium batteries, anything the sender will not
  show the Runner (Section K, 1 October ruling 1). Nothing bigger than a saloon car's boot.
- Never a silent substitution; if the Shopper cannot be reached, the item is not bought and is
  refunded (Section H).
- Handed to the person: first name and a photograph at the moment of capture; no signatures, no
  identity checks; a declined photograph is accepted without argument (Section L).

**Shops and adverts**
- Every shop is listed free, by us, with no sign-in. Big chains are listed by name without a
  dated agreement, with no logos and nothing suggesting a partnership (ruling 16).
- A shop that pays monthly becomes a Shop Partner with its own sign-in; every product is checked
  by a person first; products show only while the plan is paid (ruling 41).
- Shop and product data come from free sources (OpenStreetMap, Runners' receipts, Open Food
  Facts, Open Prices, entries by hand, retailer feeds when offered); never copied from
  supermarket websites (ruling 16).
- No white label: Ozi's name is on every delivery (Section N).
- Adverts: the genuine answer first, the advert after, labelled as an advert, checkable facts
  only (nearer, cheaper, in stock), never "better"; at most one advert per search (Section O,
  ruling 42). The advert square is never on paying screens and never read aloud (ruling 43).
- Every displayed price shows the date it was last updated (Section N). Not built.

**Data and privacy**
- Strip personal data at the point of collection, before storage, tested on Igbo, Hausa and
  Yoruba names (Section R). Not built in general.
- Business analysis records have no names, numbers or addresses: people as one-way codes,
  places as postcode districts, an optional age group; every figure covers at least ten people;
  health-revealing products never shared; insight about groups only is sold, never about people
  (rulings 13, 16, 42).
- Order and money records kept seven years, then anonymised (ruling 16). Not automated yet.
- Unmet demand recorded (Section O).
- Phrases are private and stay on the server (ruling 44).

**The owner**
- Only the owner's account sees the money (ruling 43).
- Family and investors see only what he switches on, read only (ruling 43).
- The kill switch turns every family and investor switch off and signs every admin out; nothing
  is deleted (ruling 43).

**Regions**
- Every region is its own marketplace; Medway first; a region selector from day one;
  switching automatic for business accounts and ask-first for personal ones (Section P). Not
  built.

### Overridden decisions

| Old | New | Ruling |
| --- | --- | --- |
| Delivery fee in bands (£8 to £12, £7.80, £8) and a £2 net floor (old Rule Three) | £13.50 flat, £60 maximum shopping | Section B, Anthony's answer 1 (30 Sept), RULES.md |
| Alcohol allowed where the recipient can prove their age | No alcohol in version one, no identity checks | 1 October ruling 1 |
| Ozi never listens while muted (as the only "off") | Two states: talking switch (silent, still listening) and mute button (not listening) | Ruling 21 alongside 1 October ruling 3 |
| PIN for voice orders "irrelevant"; PIN needed for some orders | No PIN to place any order; PIN only to save or change addresses | Ruling 26 |
| Pay at the door, trial orders, a spoken card | No card, no order | Ruling 29 |
| Card regions UK and EU only | Cards from any country | Ruling 18 |
| Plivo for the landline | One Twilio UK mobile number for texts, calls and telephone orders, into LiveKit | Ruling 45 (replaces 30) |
| Recovery rate 20% of each job's pay | 10%, until a solicitor confirms more is lawful | Ruling 15 |
| Callers with no account always sent to the website | Mobile callers pay by a texted Stripe link; landline callers still sent to the website | Ruling 48 (changes 46) |
| A caller's number always deleted shortly after the call | Kept as a Shopper's number if they order | Ruling 48 (changes 31) |
| Phrases for Shoppers only, copied daily to Google Drive | Phrases for every account, on the server only, never copied anywhere | Ruling 44 (changes 34) |
| At least 50 phrases per account | At least 400 per account (owner about 3,200) | Ruling 49 (changes 44) |
| "No shop-facing system" | Shop Partners with their own sign-in (listing still free) | Ruling 41 (changes Section N) |
| No product photographs | Shop Partner products have photos | Ruling 41 |
| Adverts charged about £1 per resulting delivery | Spotlight £19.99 and Spotlight Plus £39.99 a month, on top of the £29.99 partner plan | Rulings 41, 42 (change Section O) |
| A single £19.99 introductory Spotlight price for three months (proposal) | The fixed prices above | Ruling 42 |
| Business analyst staff job | Withdrawn; analysis is the founder's and whoever he switches it on for | Ruling 43 (changes 42) |
| Ozi Plus "about £7.99"; Finds It "about £2" | £7.99 and £11.99 family; £2 | Ruling 37 (firms up 36) |
| Single admin staff key | Each person their own sign-in by job; the key signs in as founder | Ruling 38 |
| Signing up by phone number only, no email | Email or phone number, whichever the person has (email not built) | Ruling 33 (adds to 24) |
| Flutterwave and Paystack "all in version one" | Stripe only for now, with Apple Pay and Google Pay; Flutterwave and Paystack to follow | Ruling 35 (changes Section R) |

### Contradictions not yet resolved

These are for Anthony to rule on. The code's current behaviour is noted.

1. **One-off addresses.** Section D allows a one-off address for one order with a touch and no
   PIN. Ruling 26 says "an order can only go to an address already saved". The code follows
   Section D.
2. **Substitutions and the till total.** Section H says the total is adjusted before payment is
   taken; ruling 29 says payment is taken before a Runner is sent. The code charges the estimate
   first, then settles the difference when the till total goes in (ruling 52), and pays the
   Runner back for the shopping at the same moment (ruling 55).
3. **Recurring orders.** Rule Five has Sets that fire by themselves after a 30-minute notice;
   ruling 37's weekly shop never sends or pays until the Shopper says so. Both exist in the
   code; only the second is in use.
4. **Ozi Line and telephone orders.** Section B and T9 price the landline as Ozi Line minute
   packages; rulings 46 and 48 charge a phone order the normal fee and say nothing of minutes.
5. **Two "family" plans.** T1's family and carer plan (£3.99 a month per person looked after)
   and ruling 37's Ozi Plus for a family (£11.99 for 30 days) are different things; it is not
   said whether the first still stands.
6. **Bundles and Rule Four.** T3's four deliveries for £48 lowers the fee for some Shoppers;
   ruling 37 refused a Plus discount on the fee for exactly that reason.
7. **Two-step sign-in for staff.** Section Q requires two-factor on every admin login without
   exception; ruling 38 set up username and password for staff, with codes only on the owner's
   account.
8. **Organisations paying by invoice** would change "no card, no order"; ruling 41 leaves it for
   Anthony.
9. **Bank transfer (ruling 50) and "no card, no order" (ruling 29)** are reconciled like this:
   an order paid by bank transfer is never sent to a Runner until staff have seen the money
   arrive, so "paid before a Runner is sent" still holds; only "a card must be saved" is relaxed,
   for that one way of paying. The till total for a bank transfer order is settled by staff by
   hand, because there is no card to refund or charge.

---

## Part 6. Technical blueprint

### Architecture

A pnpm monorepo with three packages:
- **core** (packages/core): the money rules and the store configuration parser, shared by
  everything. The fee function takes only the goods total, so surge pricing cannot be expressed.
- **api** (packages/api): a Fastify server in TypeScript, with Prisma on PostgreSQL. With no
  DATABASE_URL it runs on an in-memory store with seed data, for development. Routes cover
  accounts, auth, addresses, basket, catalogue, orders, jobs, payouts, payment methods,
  questions, problems, sets, calls, push, extras, business (partners and organisations), staff,
  owner, analytics, share, Ozi replies, telephone and webhooks (Stripe, Twilio, LiveKit). Two
  sweeps run inside the server: job offers every 10 seconds, Runner payouts every minute.
- **web** (packages/web): a React and Vite progressive web app, with pages for the Shopper,
  Runner, Shop Partner, organisation and admin panel, and the voice layer in
  packages/web/src/voice.

Configuration lives in config/: store.json (names, prices, rules), adverts.json, offers.json,
recipes.json, gifts.json, banned-words.json, ozi-phrases.json and phrases/ for each account.

### Hosting

- DigitalOcean App Platform, app **aldilivery** (the old name is kept inside DigitalOcean on
  purpose; renaming would create a second app), region **lon** (London).
- Domain **ozidelivery.co.uk** (and www), one hostname: the web app at /, the API at /api.
- Components: **web** (static site), **api** (Fastify service, smallest size, one instance,
  health check /health), **db** (a development PostgreSQL database today; a managed
  PostgreSQL 16 with backups is a launch step).
- Deploys automatically on every push to main of the GitHub repository; migrations run before
  the server starts. The spec is .do/app.yaml.
- /api/health shows the running version, the data backend, the payments mode and whether calls
  are on.

### Data model (Prisma, packages/api/prisma/schema.prisma)

| Model | What it holds |
| --- | --- |
| Shopper | A Shopper: name, phone, home address, door instructions, PIN hash, Stripe customer, Plus, Recipe Pass, family code, gift card credit, organisation link, age group. |
| Runner | A Runner: name, phone, ways of delivering, referral ID, checks, insurance date, Stripe Connect account, cool bag deposit, availability and position, and when they agreed to the Runner agreement, which version and how (ruling 55). |
| Organisation | A council, charity or business: contact, join code, monthly budget, staff-trip cost. |
| HouseholdCircle | A group of Shoppers in one household (the start of family ordering). |
| HouseholdCircleMember | A Shopper in a household, with recorded consent. |
| CatalogueItem | A product with an estimated price, category, source, and whether it is age restricted or retired. |
| PaymentMethod | A saved card: Stripe's identifier, last four digits, brand, region. Never a card number. |
| Order | An order: estimate, fee, till total, final total, confirmation record, Stripe payment, address, pool, Runner pay, and paying the Runner back for the shopping: amount, status (paid, waiting, owed), reason, transfer, when and who approved it (ruling 55). |
| OrderItem | One line of an order, with what happened at the shelf. |
| JobOffer | An offer of an order to a Runner, with its expiry, outcome and queue position. |
| RunnerPayout | What a Runner was paid for an order, with any cool bag or recovery held back. |
| Set | A recurring order: day, time, frequency, notice sent, skip. |
| SetItem | One line of a recurring order. |
| OneTimeCode | A hashed sign-in code. |
| RunnerCheck | A right-to-work or DBS check, with who made it. |
| ItemQuestion | A Runner's "cannot find it" question and the Shopper's answer. |
| PushSubscription | A device that may receive notifications. |
| SavedAddress | A saved address with a label. |
| Call | An in-app call: room, price agreed, minutes, charge and its status. |
| CallLeg | One person in a call, with their connected time. |
| RunnerDocument | A Runner's photographed document and its review. |
| RunnerFeedback | Feedback a Runner sent. |
| ProblemReport | A reported problem, its deadline, decision, fault and refund. |
| ProblemEvidence | A voice note, photo or note sent as evidence. |
| RunnerRecovery | What a Runner owes after a fault decision, recovered or written off. |
| FindRequest | An Ozi Finds It request and its outcome. |
| GiftCard | A gift card and its code. |
| OrganisationEnquiry | A shop or organisation asking to work with us. |
| StaffMember | A staff, owner, family or investor sign-in, with role, password hash, passcode, two-step and switches. |
| PartnerShop | A Shop Partner: plan paid until, Spotlight level. |
| PartnerProduct | A Shop Partner's product and its approval. |
| BusinessUser | A person signing in for a Shop Partner or organisation, with their office. |
| PartnerPayment | A payment a Shop Partner made for its plan or Spotlight. |
| SpotlightMention | Each time Ozi mentioned a Spotlight shop, for limits and reports. |
| AnalyticsEvent | Business analysis records, with one-way codes and postcode districts only. |
| IncomeRecord | The owner's ledger of money in and refunds out, by gateway. |
| LearnedPhrase | What Ozi could not answer, waiting for a person to approve an answer. |

### Environment settings (names only)

On the api component: DATABASE_URL, DATA_BACKEND, SEED_ON_START, NODE_ENV, HOST, PORT,
API_HOST, API_PORT, ALLOWED_ORIGIN, WEB_ORIGIN, STORE_CONFIG_PATH, AUTH_TOKEN_SECRET,
AUTH_TOKEN_TTL_HOURS, STAFF_API_KEY, OTP_DELIVERY, OTP_LENGTH, OTP_TTL_SECONDS,
STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, TWILIO_ACCOUNT_SID,
TWILIO_AUTH_TOKEN, TWILIO_FROM, TWILIO_VOICE_FROM, LIVEKIT_URL, LIVEKIT_API_KEY,
LIVEKIT_API_SECRET, LIVEKIT_SIP_TRUNK_ID, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
On the web component: VITE_API_URL. Secret values are typed straight into DigitalOcean with
Encrypt ticked, never into a chat or the code.

### Integrations

- **Stripe**: card payments and saved cards, Apple Pay, Google Pay and Link, Checkout links for
  telephone orders, refunds, Connect transfers to Runners. Test mode today. Webhook at
  /api/webhooks/stripe (including checkout.session.completed and .expired).
- **Twilio**: one UK mobile number for sign-in texts, codes read to landlines, order texts, and
  Ozi answering the telephone. Webhooks at /api/webhooks/twilio/voice, /status and /sms, each
  checked by signature. docs/TWILIO_AND_LIVEKIT.md has the steps.
- **LiveKit**: in-app calls, MERGE guests, minute counting by webhook at
  /api/webhooks/livekit, and a SIP trunk to Twilio for "Ring their phone instead".
- **Web Push** (VAPID): notifications at each order stage and for Runner questions.
- **Oluoma Voice**: the separate voice product (EnrichT16/OluomaApp), through the interface in
  packages/web/src/voice/engine.ts. The server swaps OLUOMA_VOICE_KEY for five-minute tokens at
  /api/voice/session; the phone's own speech is the fallback (ruling 53).

### Security measures (docs/SECURITY_PROPOSAL.md)

Done: HTTPS; strict HTTPS and safety headers on every reply; a limit on sign-in tries from one
internet address (30 in 10 minutes); account locks after wrong passwords; separate keys per kind
of account, tested; owner passcode, authenticator codes and kill switch; staff choose their own
hashed passwords; no card numbers; phone numbers never shown between Shoppers and Runners;
analysis records with no names; phrases kept on the server; secrets only in DigitalOcean.

To do: Cloudflare in front; two-step codes for all staff; daily backups and point-in-time
recovery; a locked off-site backup; an append-only audit log; alerts to the owner; Dependabot
and secret scanning; an uptime check; key rotation every six months; a Stripe restricted key;
a one-page guide for staff on phishing; Cyber Essentials before councils or the NHS; a
penetration test before about 10,000 Shoppers; a yearly incident drill.

### Testing

`pnpm run verify` runs lint (including the jsx-a11y accessibility rules), type checks, and every
test in core, api and web. The web tests run axe against every screen, and any violation fails
the build. RULES.md maps each inviolable rule to the test that proves it. Every change must pass
before it goes live.

### The daily phrases routine (rulings 34, 44, 49)

A scheduled Claude task, on Anthony's monthly plan, runs every day. It adds 50 new phrases with
answers to each account's collection (config/ozi-phrases.json and config/phrases/<account>.json),
about the app, shopping, delivery, Runners, healthy eating and everyday life around shopping,
never articles or anything outside Ozi's purpose. It runs the full checks and merges by itself
only when nothing but those phrase files changed and every test passes; anything else waits for
Anthony's "merge". Nothing is copied to Google Drive or anywhere else. Recommended ceiling about
5,000 per account (about 40,000 in the owner's), reviewed at 2,000 per account, when the daily
additions switch to answering what people really asked that Ozi could not answer (the Learning
list). Today each collection has a little over 400 phrases. The routine itself lives in Claude's
scheduled tasks, not in this repository.

---

## Part 7. Launch checklist status

From LAUNCH.md and docs/STILL_TO_DO.md, as of 7 October 2026. None of this blocks testing with
people Anthony knows (TESTING_WITH_PEOPLE.md).

| Step | Who | Status |
| --- | --- | --- |
| 1. Company name, number and registered office on the site | Anthony, then Claude | Built (ruling 54): shown in every page's footer and the legal pages from config/store.json. The company name is in; the number, registered office, ICO number and email show "to follow" until Anthony fills them in and clears each placeholder flag (docs/LEGAL_REVIEW.md). |
| 2. A telephone number for Shoppers | Anthony, then Claude | Waiting: 0800 000 0000 placeholder. |
| 3. Solicitor reads the privacy policy, terms and Runner agreement (including the 10% recovery and cancellation wording) | Anthony | AI review done instead, for now (ruling 54, docs/LEGAL_REVIEW.md): privacy and terms rewritten and no longer marked draft; cookies page added; Runner agreement written and still marked draft until employment status, paying at the till and substitution are decided. A solicitor is still advised on the risks listed there. |
| 4. ICO registration | Anthony | Waiting: pay the data protection fee, then put the number in `store.icoRegistrationNumber` and set its flag to false; also the appropriate policy document for DBS and health data (docs/LEGAL_REVIEW.md). |
| 5. Managed PostgreSQL with backups | Anthony, in DigitalOcean | Waiting: development database today. |
| 6. STAFF_API_KEY, then the owner's account and staff accounts | Anthony | Waiting. |
| 7. Stripe live keys, Connect live, live webhook, Apple Pay domain | Anthony | Waiting: test mode. |
| 8. Twilio upgrade and the UK mobile number (texts and calls) | Anthony | Waiting. |
| 9. LiveKit keys and webhook (and the SIP trunk for ringing phones) | Anthony | Waiting: call button hidden until then. |
| 10. VAPID keys for notifications | Anthony | Waiting. |
| 11. Public liability insurance (and goods in transit) | Anthony | Waiting. |
| 12. First Runners checked in the admin panel | Anthony | Waiting. |
| 13. Soft launch in Gillingham, ME7, by invitation | Anthony | After the above. |
| 14. Phone apps | Waiting | On the D-U-N-S number. |

Also needed before opening to everyone: an accessibility check by real screen reader users with
NVDA, VoiceOver, axe and WAVE, covering the admin panel (Section R); database backups and
point-in-time recovery; two-step codes on the owner account; an uptime check; Cyber Essentials
before signing councils or the NHS; and the data protection impact assessment (ruling 16).

What is already done: ordering by voice and by touch with Ozi; checkout, cards, saved addresses
and the PIN; Runner sign-up, documents, shifts, offers, shopping, questions and delivery; Runner
pay and the cool bag deposit; problems and refunds; in-app calls; telephone ordering; the admin
panel with staff jobs and the owner's account; the extras; Shop Partners and organisations; the
privacy policy, terms, cookies page and draft Runner agreement (ruling 54); paying Runners back
for the shopping and recording their agreement before the first job (ruling 55); and the checks
that run before every change goes live.

docs/STILL_TO_DO.md lists everything the blueprint asks for that is not built yet.

---

## Ruling 50 in brief (7 October 2026)

- **Paying by bank transfer** to the business account: BUILT, off until the account details are
  filled in `config/bank.json` and `enabled` is set to true. Each order gets its own reference
  (such as OZI-7K3Q2M); the owner is texted at once (OWNER_ALERT_PHONE); staff mark it received
  in the admin panel's **Payments** tab (founder and finance officer), and only then is it paid
  and offered to a Runner. Refunds to a bank transfer are made by staff and take longer.
- **Receipts** for every paid order, as a PDF the Shopper downloads: BUILT.
- **The website** is the app: the same site at ozidelivery.co.uk works in any browser and can be
  put on the phone's home screen ("Get the app"); App Store and Google Play versions follow the
  D-U-N-S number. An **About us** page, social media links (`config/social.json`, shown once
  filled), and an install prompt when ordering in a browser: BUILT.
- **Social media and community agents** on free hosting: PROPOSED, waiting for Anthony.

## Ruling 55 in brief (9 October 2026)

- **Runners are paid back for the shopping ("choice 1")**: BUILT. The Runner pays at the till
  with their own card; when they put the till total in, the app pays it back straight away to
  their own Stripe account (`packages/api/src/services/reimburse.ts`), with their £5 at
  delivery as before. Only the accepted till total, within the same limit the Shopper's card is
  settled within, never more than £60, once only (`reimburse:<order id>`). When the till needs a
  person, the pay-back waits in the Payments tab for Approve, and the owner is texted. Shown on
  the Runner's Money tab and in the owner's Money page. Rule Ten holds: the money goes straight
  out. The cool bag deposit is unchanged (see docs/LEGAL_REVIEW.md).
- **The order button says "Send my order and pay"**, on the Confirm page, in what the Shopper
  agrees to, and in Ozi's question ("Shall I send your order and pay now…"). An amendment to how
  Rule One is carried out, not to the rule.
- **The Runner agreement is agreed before the first job**: BUILT. A tick at sign-up, or on the
  Runner page for anyone who has not agreed (a spoken yes is accepted too), kept with the date,
  the version (`RUNNER_AGREEMENT_VERSION` in `packages/core`) and how. Until then, no job is
  offered and none can be accepted. The agreement page now says how paying back works. It stays
  marked as a draft until employment status and a right to send a checked substitute are
  decided and a solicitor has read it.
