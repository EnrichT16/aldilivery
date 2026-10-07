What the blueprint asks for that is not built yet

Checked against docs/BUILD_PROMPT.md on 7 October 2026. Everything here is extra: Ozi Delivery works without it. In rough order of value.

Soon, worth doing next
1. Ozi saying each stage of an order aloud when the page is open (Section G); notifications and texts at each stage are built (ruling 46).
2. An estimated arrival time on the order page (Section G).
3. Shopper feedback after delivery, with delivery credit for feedback of any kind (Section O).
4. Ozi reading the receipt aloud: what was bought, what was left out, the charge and the fee (T10).
5. The family and carer plan: someone ordering for a relative (T1). The page says "coming soon"; the data model is ready.
6. The security steps in docs/SECURITY_PROPOSAL.md marked "to do": an audit log sent to a one-way store, two-step sign-in for all staff, alerts to the owner, Dependabot and secret scanning, a locked weekly backup, Cloudflare in front (rulings 43, 44).
7. Insurance expiry reminders for Runners (2 October proposals).
8. Ozi's phrases: from about 2,000 per account, add phrases for questions people actually asked that Ozi could not answer, which means recording those questions without names (ruling 44).

Bigger pieces
- Errands, Sending and Business emergency runs as services, with their prices: extra shop, handed to the person, tipping (Sections B, C, K, L).
- Handed to the person: first name recorded and a photo at the moment of handover (Section L).
- Runner SOS button sharing live location, and navigation to the shop and the door (Section M).
- Working offline for Runners, sending evidence when the signal returns (Section M).
- Runner training content (the modules are titles only today) (T11).
- Welsh, then Igbo, Hausa, Yoruba and Swahili: a language layer for the screens (Section E).
- A region selector and marketplace switching (Section P).
- Many shops, with listings and price dates shown (Section N, ruling 16).
- Card entry on the phone keypad, for landline callers with no card saved (Twilio Pay with Stripe), ruling 28; mobile callers pay by a texted link (ruling 48).
- Email sign-up with an emailed code (ruling 33).
- Flutterwave and Paystack (rulings 17, 18, 35).
- Delivery bundles, 4 for £48 (T3); weekly spoken summary (T7); wellbeing checks (T8).
- Runner payout schedule: weekly, daily or instant (ruling 14).
- Seven-year retention then anonymisation, and a separate analytics store (rulings 13, 14, 16).
- Removing personal data before storage, tested on Igbo, Hausa and Yoruba names (Section R).
- Native apps for the App Store and Google Play, with calls that ring on a locked phone (Section F): waiting on the D-U-N-S number.

Needs Anthony before launch
- Company name, number and registered office on the site (LAUNCH.md, step 1).
- The Shopper telephone number (step 2).
- A solicitor for the privacy policy, terms and Runner agreement (step 3).
- ICO registration (step 4).
- The backed-up database (step 5).
- STAFF_API_KEY (step 6).
- Stripe live keys (step 7).
- Twilio upgrade and numbers (step 8).
- LiveKit keys, for calls (step 9).
- VAPID keys, for notifications (step 10).
- Public liability insurance (step 11).
- A real accessibility check by people using screen readers (Section R).
- Database backups and point-in-time recovery switched on, two-step codes on the owner account, an uptime check (docs/SECURITY_PROPOSAL.md, section 6).
- Cyber Essentials before signing councils or the NHS; a penetration test before about 10,000 Shoppers.
