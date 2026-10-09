# Google: Data safety answers

In the Play Console: the app, then **Policy and programmes**, then **App content**, then **Data
safety**. These follow the privacy policy (packages/web/src/pages/Privacy.tsx, reviewed 9
October 2026) and match the Apple answers in apple-privacy.md. Where Google's wording is unclear,
the answer is the more cautious one.

## Data collection and security

- Does your app collect or share any of the required user data types? **Yes.**
- Is all of the user data collected by your app encrypted in transit? **Yes.** (Everything goes
  over HTTPS.)
- Which of the following methods of account creation does your app support? **Username and
  other authentication** (a telephone number and a texted code, and a PIN).
- Do you provide a way for users to request that their data is deleted? **Yes.**
- Delete account URL: **https://ozidelivery.co.uk/help#close-account**

## Sharing

Google counts "sharing" as passing data to another company, but not to a service provider
working for us (DigitalOcean, Stripe, Twilio, LiveKit, Oluoma Voice), not when the person asks
for it (a Runner seeing the address of the order they are delivering), not for the law, and not
anonymous figures. Our figures for shops always cover at least ten people.

So for every type below: **Shared: No.**

## Data types to declare as collected

For each, Google asks: collected or shared (collected), processed ephemerally (no, unless it
says yes), required or optional, and the purposes.

### Location

- **Approximate location**: Analytics. Required. (The postcode district, such as ME7, from the
  delivery address.)
- **Precise location**: App functionality. Optional: only Runners, only on shift and during an
  SOS; Shoppers are never located. (If Google insists, choose Required, because a Runner cannot
  take jobs without it.)

### Personal info

- **Name**: App functionality, Account management. Required.
- **Phone number**: App functionality, Account management. Required.
- **Address**: App functionality. Required.
- **User IDs**: App functionality, Analytics, Account management. Required.
- **Other info**: App functionality, Analytics. Optional. (Age group, if given; door
  instructions.)
- **Email address**: do not declare, unless Shoppers are asked for one by the time you submit.

### Financial info

- **Payment info**: App functionality, Fraud prevention, security and compliance. Required.
  Card details are collected by Stripe, our payment provider, inside the app, which Google still
  counts as collection by us. We keep only the last four digits and the card type.
- **Purchase history**: App functionality, Analytics. Required.
- **Other financial info**: App functionality. Optional. (Runners' pay records; bank transfer
  references.)

### Health and fitness

- **Health info**: App functionality. Optional. (Only if someone chooses to tell us about a
  disability or health need in their door instructions.)

### Messages

- **Other in-app messages**: App functionality. Optional. (A Runner's question about an item and
  the Shopper's answer; feedback.)

### Photos and videos

- **Photos**: App functionality. Optional. (Till receipts, Runner documents and face photo,
  photos sent with a problem.)

### Audio

- **Voice or sound recordings**: App functionality, Customer support. Optional. (A voice note
  sent with a problem.) Also speech to Ozi: **processed ephemerally: Yes**, because it is
  turned into words and not kept.

### App activity

- **App interactions**: Analytics. Required. (Purchases, deliveries and searches, recorded with
  a code instead of a name.)
- **In-app search history**: App functionality, Analytics. Required.
- **Other user-generated content**: App functionality. Optional. (Door instructions; the words
  of a question Ozi could not answer, with names, numbers and addresses taken out.)

### Device or other IDs

- **Device or other IDs**: App functionality, Fraud prevention, security and compliance.
  Required. (The address a phone gives us for notifications, and the internet address recorded
  when someone signs in.)

## Not collected

Contacts, Calendar, Web browsing history, Files and documents (documents arrive as photos),
Music files, Emails, SMS or MMS, Race and ethnicity, Political or religious beliefs, Sexual
orientation, Credit score, Fitness info, Installed apps, Crash logs, Diagnostics, Other app
performance data.

## Other App content declarations on the same page

- **Privacy policy**: https://ozidelivery.co.uk/privacy
- **App access**: "All or some functionality is restricted". Give the review sign-in from
  review-notes.md.
- **Ads**: does the app contain ads? **Yes** if `config/adverts.json` has the advert square
  switched on, or any Shop Partner has Spotlight, on the day you submit; otherwise **No**. Change
  it the day either is switched on.
- **Content rating**: see age-rating.md.
- **Target audience and content**: **18 and over** only. The app is not designed for children.
- **News app**: No. **COVID-19 app**: No. **Government app**: No.
- **Financial features**: None of the listed ones. (Runners are paid through Stripe Connect,
  which is not a financial product we offer.)
- **Health apps**: No, it is not a health app.
- **Data safety**: this file.
