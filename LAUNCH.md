Before Ozi Delivery opens to the public

This is the list of what has to be true before strangers can order. It is written for Anthony, in the order to do things. Each step says who does it. Steps marked "Claude" are changes to the code; tell Claude the detail and it will make them. Everything else is done by a person, in a website or on the phone. DEPLOY.md has the click-by-click steps for the settings mentioned here.

None of this needs doing for testing with people you know (TESTING_WITH_PEOPLE.md). It is for the day the site is opened to everyone.


Step 1. The company's details on the site. Anthony, then Claude.

The law (the Companies Act and the Consumer Contracts Regulations) says the website must show the company's registered name, its company number, where it is registered (England and Wales), and its registered office address. Today the site shows a placeholder.

Send Claude: the exact registered name of Ozi Delivery Ltd as it appears on Companies House, the company number, and the registered office address. Claude puts them in config/store.json, and they then appear in the privacy page, the terms and the footer.


Step 2. A telephone number for Shoppers. Anthony, then Claude.

Many Shoppers will ring rather than use the app, and the terms say "ring us" to cancel. Today the number shown is a placeholder, 0800 000 0000.

Get a number that a person answers in working hours (a Twilio number forwarding to a mobile is enough to start). Send Claude the number and it goes into config/store.json.


Step 3. A solicitor reads the privacy policy and the terms. Anthony.

Both pages are drafts, written from what the service actually does, and both say "draft" at the top. Open ozidelivery.co.uk/privacy and ozidelivery.co.uk/terms, or send the solicitor those two links. When they have changed what needs changing, send Claude their wording, and Claude removes the word "draft".

Ask the solicitor about three things in particular:
- the Runner agreement, which does not exist yet: Runners are self-employed, and the agreement needs to say so properly, including the 10% of each job taken back when a Runner is found at fault;
- the 10% figure itself, which is set to 10% until the solicitor confirms what the law allows;
- the cancellation wording, "ring us before your Runner starts shopping".


Step 4. Register with the Information Commissioner's Office. Anthony.

A company that keeps people's information must pay the data protection fee. It is done online at ico.org.uk, under "Register", in about fifteen minutes, and for a small company it is about fifty pounds a year (check the figure on the page). The registration number can then go in the privacy page: send it to Claude.


Step 5. A database that is backed up. Anthony, in DigitalOcean.

Today the app uses a development database. It is not backed up. If it were lost, every order, every Runner's checks and every money record would be lost with it, and the law says money records must be kept for seven years.

In DigitalOcean, create a managed PostgreSQL database, version 16, in London, the smallest size (it has daily backups kept for seven days, and can be restored to any moment in that week). Then, in the app's settings, attach it to the api component in place of the development database, so DATABASE_URL points at it. The app creates its own tables when it starts. Because there are no real orders yet, nothing needs copying across. Do it before the first real order, not after.

Please do not rename the app or the database while you are there; other settings depend on the names.


Step 6. The admin panel key. Anthony, in DigitalOcean.

The admin panel is at ozidelivery.co.uk/staff. It is where documents are checked, problems decided, and Runner feedback read. It signs in with a staff key, which does not exist yet, so today it refuses everybody.

Make a key: in DigitalOcean, open the api component's Console and type: openssl rand -base64 32
Then add it as an environment variable on the api component, named STAFF_API_KEY, ticking Encrypt. Keep the key somewhere safe, such as a password manager, and give it only to the people who run the service. Do not paste it into a chat, including this one.

To sign in, open /staff, type your name (it is recorded with each decision) and the key.


Step 7. Stripe, for real money. Anthony.

Today Stripe is in test mode: no real card is charged. To take real payments:
- In Stripe, finish activating the account for Ozi Delivery Ltd: the company number, the bank account money is paid into, and the identity checks Stripe asks for.
- Turn on Connect for live, so Runners can be paid.
- Switch the dashboard from test mode to live mode, and copy the live secret key and live publishable key into the api component's STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY, the secret one encrypted.
- In live mode, add the webhook endpoint again (DEPLOY.md, "Creating the Stripe webhook and getting the last secret"): live mode has its own, with its own signing secret, which goes in STRIPE_WEBHOOK_SECRET.
- In Connect settings, under branding, set the name to Ozi Delivery.

Then place one small real order yourself, report a problem on it, and decide the refund in the admin panel, to see the whole thing work with real money.


Step 8. Text messages. Anthony, in Twilio.

Signing in sends a code by text. On a Twilio trial account, texts only reach numbers you have added by hand. Upgrade the Twilio account (add a card), and set TWILIO_FROM to the sender name OziDelivery. DEPLOY.md, "Signing in by text message", has the steps.


Step 9. In-app calls. Anthony, in LiveKit and DigitalOcean.

The LiveKit project is made. Put its three values, LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET (encrypted), on the api component, and add the webhook in LiveKit. DEPLOY.md, "Switching on in-app calls", has the steps. Until then, the call button is simply not shown. Calls cost the Shopper 5p a minute, and LiveKit's own charges should be checked against that in its billing page after the first week.


Step 10. Notifications. Anthony, in DigitalOcean.

So a Shopper's phone can buzz when their Runner has a question: make the key pair once and add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY. DEPLOY.md, "Telling a Shopper about a question". Without them, the question still appears on the Your order page.


Step 11. Insurance. Anthony.

Ask an insurance broker about public liability insurance for the company, and whether it should cover goods in transit. Runners who drive need their own motor insurance with business use, and the app already asks for it and checks its expiry date; the broker can say whether the company also needs cover of its own.


Step 12. The first Runners. Anthony, in the admin panel.

Each Runner's right to work and DBS certificate are checked by a person, in the admin panel, before they can take a job. Check the share codes on the government website (gov.uk, "Check a job applicant's right to work") before pressing Accept. Start with a handful of Runners you have met.


Step 13. A soft launch. Anthony.

Open in one area first, Gillingham and the ME7 postcode, to people you invite: friends, family, a local group. Watch the admin panel each day for problems, and keep the two-working-day promise for deciding them. Widen it once a week has gone by without surprises.

Before each widening, open ozidelivery.co.uk/api/health. It should show the latest version in commit, and dataBackend postgres, paymentsMode stripe and callsEnabled true. If it shows an old version, a deploy has failed: tell Claude.


Step 14. The phone apps. Waiting.

The Apple and Google store accounts are waiting on the company's D-U-N-S number. The website works on phones in the meantime, and can be added to the home screen. Nothing here waits on the apps.


What is already done

The ordering, by voice and by touch, with Ozi; checkout, paying by card, saved cards and addresses, and the PIN; Runners signing up with their documents, going on shift, being offered jobs, shopping, asking about missing items, and delivering; Runner pay and the cool-bag deposit; reporting problems, with refunds of five pounds or less straight away; in-app calls; the admin panel; the privacy policy and terms, in draft; and the checks that run before every change goes live.
