# Switching on Twilio and LiveKit

For Anthony, with Yvette or whoever helps at the keyboard (rulings 28, 45 and 46). Everything
in the app is built; these are the settings that switch it on. Type secret values straight
into DigitalOcean, never into a chat.

All the DigitalOcean settings go in the same place: open the app, then **Settings**, then the
**api** component, then **Environment Variables**. Tick **Encrypt** for anything marked
secret. Saving restarts the app by itself.

## What each part does

| Part | What it gives people | Needs |
| ---- | -------------------- | ----- |
| Texts | Sign-in codes; "your order is on its way" texts for people without notifications; the sign-up link after a phone call | Part 1 |
| Phone calls for codes | The sign-in code read out to a landline | Parts 1 and 2 |
| Ordering by telephone | Ring the number, Ozi answers and takes the order, and rings back if cut off | Parts 1, 2 and 3 |
| In-app calls | Shopper and Runner talk in the app, with MERGE for a carer | Part 4, first half |
| Ring their phone | A Runner rings a Shopper who has no app, without seeing the number | Part 4, all of it |

## Part 1: the number, and texts

1. Finish Twilio's regulatory registration for a **UK mobile number** (+44 7), as a business,
   direct customer. Turn on **Messaging** and **Voice** for it.
2. In DigitalOcean, set:
   - `OTP_DELIVERY` = `sms`
   - `TWILIO_ACCOUNT_SID` = the Account SID from the Twilio console's home page (secret)
   - `TWILIO_AUTH_TOKEN` = the Auth Token from the same page (secret)
   - `TWILIO_FROM` = the number, written `+447…`

## Part 2: calls from the number

In DigitalOcean, set `TWILIO_VOICE_FROM` = the same number, `+447…`.

## Part 3: Ozi answers the number

In the Twilio console, open **Phone Numbers**, then **Active numbers**, then the number:

1. **Voice configuration**, "A call comes in": **Webhook**,
   `https://ozidelivery.co.uk/api/webhooks/twilio/voice`, **HTTP POST**.
2. "Call status changes": `https://ozidelivery.co.uk/api/webhooks/twilio/status`,
   **HTTP POST**. This is how Ozi knows a call was cut off, to ring back.
3. **Messaging configuration**, "A message comes in": **Webhook**,
   `https://ozidelivery.co.uk/api/webhooks/twilio/sms`, **HTTP POST**.
4. Save. Ring the number from your own phone to try it.

Every request from Twilio is checked against the Auth Token, so nobody else can pretend to be a
caller. If the Auth Token is ever changed in Twilio, change it in DigitalOcean too, or Ozi will
stop answering.

## Part 3b: paying by a texted link

Somebody with no account, or no card saved, can still order by telephone: Ozi texts them a
Stripe link to pay and give their address (ruling 48). In the Stripe dashboard, open
**Developers**, **Webhooks**, the existing endpoint, and add the events
**checkout.session.completed** and **checkout.session.expired**. Nothing else to set.

## Part 4: LiveKit

First half, in-app calls (DEPLOY.md, "Switching on in-app calls", has the screens):

1. In LiveKit Cloud, open the project, then **Settings**, then **Keys**. Copy the URL, the
   API key and the API secret.
2. In DigitalOcean, set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` (secret).
3. In LiveKit, **Settings**, **Webhooks**: add `https://ozidelivery.co.uk/api/webhooks/livekit`
   with the same API key. This is what counts call minutes.

Second half, ringing a Shopper's own phone, which joins LiveKit to Twilio:

1. In the Twilio console, open **Elastic SIP Trunking**, then **Trunks**, and create a trunk
   named "LiveKit".
2. In the trunk, **Termination**: choose a termination address (for example
   `ozidelivery.pstn.twilio.com`) and, under **Credential lists**, make a username and a long
   password. Keep them for the next step, typed only into LiveKit.
3. In the trunk, **Numbers**: add the Twilio number.
4. In LiveKit Cloud, **Telephony**, then **SIP trunks**, **Create new trunk**, **Outbound**:
   address = the termination address from step 2; numbers = `+447…`; username and password
   from step 2.
5. LiveKit shows the trunk's id, beginning `ST_`. In DigitalOcean set `LIVEKIT_SIP_TRUNK_ID`
   to it.

Then, on a call, a Runner sees **Ring their phone instead**. The Shopper's phone shows our
number; the Runner never sees or hears theirs. It costs the Shopper nothing.

## What it costs us, roughly

Twilio's UK prices change, so check its pricing page; in October 2026 they were about: a mobile
number £1 to £2 a month; a text about 4p; a call answered or made about 1p to 3p a minute,
more to mobiles; speech recognition for Ozi on the phone about 2p for each 15 seconds heard.
A five-minute phone order costs roughly 20p to 40p. LiveKit charges by the minute after its
free allowance, and for SIP minutes; its billing page shows both.
