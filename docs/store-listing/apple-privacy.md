# Apple: App Privacy answers (the privacy "nutrition label")

In App Store Connect: the app, then **App Privacy**, then **Get Started**. Privacy policy URL:
https://ozidelivery.co.uk/privacy

These answers follow the privacy policy (packages/web/src/pages/Privacy.tsx, reviewed 9 October
2026). Where Apple's categories are unclear, the answer is the more cautious one: declaring
something we collect is never a problem; leaving it out is.

## First question: do you or your partners collect data from this app?

**Yes.**

## Tracking

**No, we do not use data for tracking.** Nothing is linked with data from other companies' apps
or websites for advertising, and nothing is shared with data brokers. The app shows no
third-party adverts. (Spotlight mentions and the advert square are our own adverts for local
shops, chosen from what you searched for, inside our own app. They use no data from anywhere
else, so they are not "tracking" in Apple's sense.)

So for every data type below: **Used to track you: No.**

## The data types to tick, and what to say for each

For each, Apple asks the purposes, and whether it is linked to the person. Unless it says
otherwise, every one is **Linked to the user's identity: Yes**.

### Contact Info

- **Name**: App Functionality. (To sign in, and so the Runner knows who to give the shopping to.)
- **Phone Number**: App Functionality. (Sign-in codes, order texts, ordering by telephone.)
- **Physical Address**: App Functionality. (Where the shopping goes.)
- **Email Address**: do not tick, unless Shoppers are asked for one by the time you submit.
  Today only Shop Partners and organisations give one, on the website.

### Health and Fitness

- **Health**: App Functionality. Only if someone chooses to tell us, in their door instructions
  or settings, about a disability or health need so the Runner can help (such as "I am blind,
  please knock loudly"). Optional.

### Financial Info

- **Payment Info**: do not tick. Card numbers are typed into Stripe's own form and go straight
  to Stripe; we never receive them. Apple says data collected only by a payment processor, and
  not available to you, need not be declared. We keep only the last four digits and the card
  type, which is not Payment Info in Apple's sense.
- **Other Financial Info**: App Functionality. (What Runners were paid and anything held back;
  bank transfer references. Runners' bank details go to Stripe on Stripe's pages, never to us.)

### Location

- **Precise Location**: App Functionality. Runners only, while on shift, to offer nearby jobs,
  and while an SOS is on. Shoppers are never located.
- **Coarse Location**: Analytics. (The postcode district, such as ME7, recorded with each
  order for our figures, taken from the delivery address.)

### User Content

- **Photos or Videos**: App Functionality, Customer Support. (Till receipt photos, Runner
  documents and face photo, photos sent with a problem.)
- **Audio Data**: Customer Support. (Voice notes someone chooses to send with a problem.) Speech
  sent to Ozi is turned into words straight away and never kept, which Apple does not count as
  collection.
- **Customer Support**: Customer Support. (Problem reports, feedback.)
- **Other User Content**: App Functionality, Product Personalisation. (Door instructions, answers
  to a Runner's question, the words of a question Ozi could not answer, kept with names, numbers
  and addresses taken out, so a person can teach Ozi a better answer.)

### Identifiers

- **User ID**: App Functionality, Analytics. (The account number; in our figures, a one-way
  code made from it.)
- **Device ID**: do not tick. The app uses no advertising identifier. The notification address
  a phone gives us is used only to send that phone our notifications.

### Purchases

- **Purchase History**: App Functionality, Analytics. (Orders, what the till charged, extras
  bought.)

### Search History

- **Search History**: App Functionality, Analytics. (What was searched for, recorded in our
  figures without a name.)

### Usage Data

- **Product Interaction**: Analytics. (Purchases, deliveries and searches, in our figures,
  under a code instead of a name.)
- **Advertising Data**: do not tick (no third-party adverts).

### Diagnostics

- Do not tick any. The app sends no crash reports or performance data to us or anyone else.
  If a crash reporting service is ever added, this changes.

### Other Data

- **Other Data Types**: App Functionality. (Security records: when someone signed in and from
  which internet address, kept one year to stop people guessing codes and passwords. Age group,
  only if someone gives it in Settings.)

## Not collected (leave unticked)

Contacts, Emails or Text Messages, Gameplay Content, Browsing History, Sensitive Info (beyond the
optional health note above), Fitness, Credit Info, Advertising Data, Crash Data, Performance
Data, Other Diagnostic Data, Device ID, Email Address (see above).

## Account deletion (Apple guideline 5.1.1(v))

Apple requires that anyone who can make an account in the app can delete it in the app.
Shoppers can: Settings, Close my account, or by asking Ozi. **Runners cannot yet** close their
account in the app; today they ring or email. This must be built before submitting to Apple
(docs/APP_STORES.md, "Before submitting").
