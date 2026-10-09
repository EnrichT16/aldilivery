What the blueprint asks for that is not built yet

> **9 October 2026 (ruling 56):** items 1, 2, 3, 4, 6, 7, 9, 10, 12, 13, 14 and 16 below are now built, as are the Runner SOS and navigation, the payout schedule, the private referral reward, and closing accounts with the retention sweep. See docs/changes/. Left from those: orders booked for one future time, feedback patterns on the partner dashboard, and the Runner check records kept two years after a Runner stops.
Checked against docs/BUILD_PROMPT.md (Sections A to T and rulings 1 to 53) and against the code itself on 7 October 2026, and brought up to date for ruling 55 on 9 October 2026 (Runners paid back for the shopping, the "Send my order and pay" button, and the Runner agreement agreed before the first job: all built). Everything that is now built has been taken off. docs/MASTER_BLUEPRINT.md has the full picture of what is built. In rough order of value.

Soon, worth doing next
1. Settling the till total is built (ruling 52); still to do: the owner's own screen for the orders that need a person (a large extra, or a bank transfer). Paying the Runner back for those orders already waits in the Payments tab with an Approve button (ruling 55); the Shopper's side of them is still settled by hand.
2. A photo of the till receipt, taken in the app when the till total goes in, kept with the order, so a person approving a pay-back (ruling 55) or a large extra can see it. Today the Runner types the total and keeps the paper receipt.
3. Ozi asking a Runner to agree to the Runner agreement by voice. The server already accepts a spoken yes (channel "voice"); the Runner screens offer the tick only.
4. Recurring orders on a clock. The rules for Sets (notice thirty minutes before, the one word skip) are written and tested, but nothing runs them and the notice is not sent by notification or text. Orders booked for one future time are not built (Section I, Rule Five).
5. Ozi saying each stage of an order aloud when the order page is open (Section G); notifications and texts at each stage are built (ruling 46).
6. An estimated arrival time on the order page that updates (Section G).
7. The door safe word: the Runner's first name and a two-word code for every order (T6).
8. Ozi reading the receipt aloud: what was bought, what was left out and why, the charge and the fee as its own line (T10).
9. A substitution call started from the Runner's "cannot find it" prompt in one tap (Section H); the question on the Shopper's screen and the separate call button are built.
10. Shopper feedback after delivery, with delivery credit for feedback of any kind, and shops shown patterns only (Section O).
11. The family and carer plan: a relative's own view, alerts, approving over a limit (T1). The page says "coming soon".
12. The admin panel's missing parts: live and past orders, Runners active now and their earnings, price freshness, signups by period, cancellations with reasons; owner-only opening of a Shopper's account, refunds above a threshold and data export; and spoken answers for "how many signups this month", "what refunds went out yesterday and why" and "read me the cancellations" (Section Q).
13. An audit log of every admin action, unchangeable, seen by the owner only (Section Q, docs/SECURITY_PROPOSAL.md).
14. Two-step codes for every staff sign-in, not only the owner's (Section Q, ruling 44).
15. The other security steps marked "to do" in docs/SECURITY_PROPOSAL.md: alerts to the owner, Dependabot and secret scanning, a locked weekly backup, Cloudflare in front, a staff guide on trick messages (ruling 44).
16. Insurance expiry reminders for Runners who drive (2 October proposals, approved in ruling 14).
17. Ozi mentioning its own features from time to time, spaced out, with the frequency in Settings and a way to switch it off (Section E).
18. Every displayed price showing the date it was last updated (Section N).
19. The short guide to using Ozi with a Braille display through VoiceOver or TalkBack, tested with a real display (ruling 40, step 1).

Bigger pieces
- Errands, Sending and Business emergency runs as services, with their prices; the extra shop charge (£2.50 or £4); the nearer shop saving said in pounds; tipping after delivery, never asked for aloud (Sections B, C, K).
- Sending rules: the declared contents list, the contents photograph, and the police procedure that protects the Runner first (Section K).
- Handed to the person: the £2 at checkout, the first name and a geotagged photograph sent at the moment of capture (Section L).
- Runner SOS button sharing live location, and navigation to the shop and the door (Section M).
- Working offline for Runners, keeping evidence until the signal returns (Section M).
- Runner training content and completion records, with jobs only offered to Runners who passed the modules they need; the modules are titles only today (T11).
- Enhanced DBS with the adults' barred list before sheltered housing rounds, wellbeing checks and handovers to the person (ruling 16); the DVLA check code and automatic MOT and road tax checks (2 October proposals).
- Runner payout schedule: weekly by default, daily, or instant at Stripe's fee shown first (ruling 16). Today each job is paid as it is delivered.
- The private referral reward: £150 when someone has referred 100 people who each paid for an order that was not refunded, with the guards against cheating, tracked in the admin panel and not announced (rulings 12, 16). Runner IDs and share counts are built.
- Sheltered housing rounds, building on the pooling already there (T5); the wellbeing check, after training (T8); delivery bundles, 4 for £48 (T3); the weekly spoken summary (T7).
- Council invoicing and commissioner reports (T2); organisation dashboards and statements are built.
- Ozi Line minute packages for the telephone (Section B, T9), if they still stand (see below).
- Card entry on the phone keypad for landline callers with no card saved (Twilio Pay with Stripe) (rulings 28, 46); mobile callers already pay by a texted link (ruling 48).
- Email sign-up with an emailed code (ruling 33).
- Flutterwave, Paystack and mobile money such as MTN, Orange and EcoCash (rulings 17, 18, 35).
- Welsh, then Igbo, Hausa, Yoruba and Swahili: a language layer for every screen and everything Ozi says, the admin panel included (Section E).
- Two or three chosen output voices per language; Settings lists Oluoma Voice's voices when it is switched on (ruling 53), and otherwise whatever voices the phone has (Section E).
- Oluoma Voice's live connection, so words appear as they are spoken and Ozi stops the moment the Shopper talks over it; today the app records until the Shopper stops, then sends it (ruling 53).
- The Oluoma phone bridge, being built in EnrichT16/OluomaApp, to replace Twilio's voice (Polly) on the telephone line (ruling 53).
- "Hey Ozi" while muted: needs a wake word on the device itself, which Oluoma Voice does not have yet, and the phone apps.
- A region selector and marketplace switching (Section P).
- Many shops: OpenStreetMap shop data, a list linking items to kinds of shop, prices from Runners' receipts, Open Food Facts and Open Prices (Section N, ruling 16).
- Seven-year retention of order and money records, then anonymisation, done automatically (ruling 16).
- Removing personal data at the point of collection, before storage, tested on Igbo, Hausa and Yoruba names (Section R).
- Native apps for the App Store and Google Play, with calls that ring on a locked phone, "Hey Siri, pick up the call", loudspeaker by default, and pinch to zoom (Section F, ruling 43): waiting on the D-U-N-S number.
- The deafblind mode, a Braille connector, Ozi's own Braille pad and a Braille device (ruling 40, steps 2 to 5); haptic alerts, the Sonara device and the wrist band (Section S). Roadmap only; nothing here holds up the launch.

Needs Anthony before launch
- Company name, number and registered office on the site (LAUNCH.md, step 1).
- The Shopper telephone number (step 2).
- A solicitor for the privacy policy, terms and Runner agreement, including the 10% recovery rate and paying Runners back for the shopping (step 3, rulings 15, 55).
- A ruling on the cool bag deposit and Rule Ten: while the £10 is held back it is Runner money held by the service (docs/LEGAL_REVIEW.md). Ruling 55 left the deposit as it is.
- Whether a Runner may send a checked substitute, and employment status: the two things keeping the Runner agreement marked as a draft.
- ICO registration and a data protection impact assessment (step 4, ruling 16).
- The backed-up database, with point-in-time recovery switched on (step 5).
- STAFF_API_KEY, then the owner's account (step 6).
- Stripe live keys (step 7).
- Twilio upgrade and the UK mobile number (step 8).
- LiveKit keys, for calls, and the SIP trunk for ringing a Shopper's phone (step 9).
- VAPID keys, for notifications (step 10).
- Public liability insurance (step 11).
- A real accessibility check by people using NVDA and VoiceOver, with axe and WAVE, covering the admin panel (Section R).
- Two-step codes on the owner account and an uptime check (docs/SECURITY_PROPOSAL.md, section 6).
- Cyber Essentials before signing councils or the NHS; a penetration test before about 10,000 Shoppers.
- Rulings needed where the blueprint disagrees with itself: a one-off address with no PIN (Section D) against "only an address already saved" (ruling 26); Ozi Line minute packages (Section B, T9) against telephone orders at the normal fee (rulings 46, 48); whether the family and carer plan (T1) still stands beside Ozi Plus for a family (ruling 37); whether bundles (T3) are a fee that depends on the Shopper (ruling 37, Rule Four); two-step for every staff login (Section Q) against ruling 38; organisations paying by invoice (ruling 41).
