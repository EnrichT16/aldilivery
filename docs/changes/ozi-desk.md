# Ozi's desk, and the automatic check

Decided by Anthony on 22 October 2026, recorded as ruling 74 in docs/BUILD_PROMPT.md.

## Why

Anthony is registered blind and has no staff yet. Until now, anything that needed a person sat on a screen in the admin panel, or arrived as a text, and waited until he went looking for it. A Runner who sent every document on a Sunday heard nothing until someone opened the Documents tab. Anthony asked for two things: that Ozi rings him about anything that needs him, and that whatever is clearly fine is approved without him.

## What needs him

Anything that needs the owner is now a matter on Ozi's desk. A matter has one or two sentences that Ozi says aloud on the call, and either three choices (approve, decline, or decide later) or two (I have heard it, or tell me later). Ozi never says a card number or a customer's telephone number: before a sentence is kept, any long run of digits and any email address is taken out.

A matter is made at the moment something happens. These become matters: a Runner document the automatic check could not approve; a shop product it was not sure about; a new shop waiting for approval; an organisation asking to work with us; a complaint or problem, with any refund the Shopper asked for; feedback with one or two stars, or with anything written in it; paying a Runner back, or a till total, that needs a person; a bank transfer order; a Finds It request; a shop product whose price is only an estimate, so he can approve the estimate; and a Runner's SOS, which is still texted straight away and is now an urgent matter as well. A service's enquiries belong to the service and never go to him.

So that nothing is missed, Ozi also uses the admin panel's "Needs you now" page as a checklist. Every minute, anything on that page that has no matter yet is put on the desk, including orders that have waited too long for a Runner. If somebody deals with something in its own tab first, its matter settles by itself and Ozi does not ring about it.

## The call

Ozi rings the number in OWNER_ALERT_PHONE from our Twilio number. Twilio listens for an answering machine, so a voicemail never counts as Anthony picking up: Ozi puts the phone down and tries again as planned.

When he answers, Ozi says "Hello, Mr. Anthony. This is Ozi.", how many things need him, and then each one in turn, urgent ones first. After each it says "Press 1 to approve, 2 to decline, 3 to decide later", or, for something he only needs to hear, "Press 1 if you have heard it, 3 to hear it later". Pressing 1 or 2 does exactly what the button in the admin panel does, and the audit log records that Mr. Anthony decided it by phone. If he says nothing, Ozi says it once more, then moves on and keeps it for the next call. At the end Ozi says "That's everything. Goodbye, Mr. Anthony."

## When Ozi rings, and how often

Exactly as Anthony asked. If he does not pick up, Ozi rings again about two minutes later, up to three calls in a row. After the third unanswered call it waits an hour, then rings three times again, and so on, until he answers and every open matter is either decided or put to later. Something new that arrives while this is going on joins it; it does not start another round. Something urgent, such as an SOS, does not wait for the hour.

A text goes with the first call of each round, as a backup. It only says how many things are waiting, never what they are.

Anything he puts to later comes back an hour later (Anthony's change on 22 October 2026; it was nine the next morning), or as soon as quiet hours end if the hour falls inside them, unless he or someone else decides it in the admin panel first.

Quiet hours are Anthony's choice and can be changed: as set now, Ozi does not ring between nine in the evening and eight in the morning, UK time, unless something is urgent. All of these figures are in `ownerDesk` in config/store.json.

## In the admin panel

The "Needs you now" page now has a short list called Ozi's desk, with each open matter and its buttons: Approve, Decline and Later, or Heard it. Choosing there has the same effect as the keypad.

## The automatic check

When a Runner sends a photo of a document, the automatic check reads it: whether it is the document we asked for, whether it can be read, the name on it, any expiry date, whether anything is recorded on a DBS certificate, and whether a face photo is a clear photo of a real face. Once every document is in, it compares the names on them with each other and with the account. Only if the Runner has ticked the box "I agree that Ozi Delivery may compare my face photo with the photo on my ID to confirm it is me" does it also compare the face photo with the photo on their ID.

The automatic check approves documents only when every check is clearly fine. It never turns anybody down. Anything unclear, out of date, not matching, or with something recorded on the DBS certificate goes to Anthony with the reason in one sentence, and he decides. A share code cannot be checked this way, so it always goes to him to check on GOV.UK. If the Runner has not agreed to the face comparison, he is asked to compare the photos himself.

A shop's new or changed product is checked too. Clear ones go live at once. Ones that are clearly against our rules (alcohol, tobacco, medicines and the other things we never bring, the services we never list, or anything over the most one product may cost) are refused by those rules. Anything the check is unsure about goes to Anthony.

When the server starts, it checks once whatever was already waiting, so a Runner who sent their documents before this was built is not left out.

Without the language model key nothing is automatic, and everything goes to Anthony. Every automatic decision is in the audit log as "The automatic check", with its reasons. The privacy page has a paragraph explaining the check and the face comparison.

## What has to be set for the calls

OWNER_ALERT_PHONE, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VOICE_FROM and ALLOWED_ORIGIN. Each call tells Twilio where to ask what to say and where to report how the call went, so nothing needs setting on the number in the Twilio console. LANGUAGE_MODEL_KEY switches the automatic check on.

## In the app first, then his mobile

Decided by Anthony on 23 October 2026, recorded as ruling 79 in docs/BUILD_PROMPT.md.

Each time Ozi tries to reach him, it now rings him in the app first. Every device where he has allowed Ozi to ring him gets a notification, "Ozi is calling, Mr. Anthony", which never says what the matters are. If the admin panel is open, the whole screen becomes the incoming call: a screen reader announces "Ozi is calling", the focus is on Answer, and Ozi asks aloud "Say answer, or not now". He can press Answer or Not now, use the keyboard (Escape is Not now), or say "answer" or "not now".

If he does not answer in the app within 30 seconds, the same attempt rings his phone, exactly as before. An attempt is the app ringing and then the phone, so the rounds are unchanged: three attempts about two minutes apart, then an hour, until everything is decided or put to later. If no device is set to ring and the panel is not open, Ozi rings the phone straight away. Quiet hours (22:50 to 06:00 UK time) and the rule that urgent matters ring in them are unchanged. "Not now" ends that attempt without ringing the phone, and Ozi tries again as it would after an unanswered call.

When he answers in the app, Ozi says the same things it says on the phone, in the browser's own voice: "Hello, Mr. Anthony. This is Ozi.", how many things need him, and then each one. He answers each with the big buttons (Approve, Decline and Later, or Heard it and Later), with 1, 2 and 3 on a keyboard just like the keypad, or by saying "yes" or "approve", "no" or "decline", "later" or "heard it". Each answer does exactly what the keypad does, and the audit log records that Mr. Anthony decided it on Ozi's call in the app. Anything Ozi does not understand, it asks again. At the end: "That's everything. Goodbye, Mr. Anthony."

### Setting it up

In the admin panel, My settings has a part called "Ozi's calls" with two buttons:

- **Let Ozi ring me in the app** asks the browser to allow notifications, and keeps this device against his own account. Press it on each phone, tablet or computer he uses. On an iPhone or iPad the app must be on the Home Screen first.
- **Test Ozi's call** rings him in the app straight away, and then his phone if nobody answers within 30 seconds, saying it is a test. It never counts as one of Ozi's real calls, so Yvette can prove both work.

The part also says how many devices are set to ring and whether his phone is set up. It never shows the number.

Notifications need VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, as for Shoppers. The phone still needs OWNER_ALERT_PHONE, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VOICE_FROM and ALLOWED_ORIGIN. How long the app rings is `ownerDesk.appRingSeconds` in config/store.json.

### Checking from outside

`/api/health` now answers two more questions with yes or no, and never shows the number: `ownerPhoneSet` says whether OWNER_ALERT_PHONE is a real UK number, and `ownerDeskCanRing` says whether that, Twilio's voice settings and ALLOWED_ORIGIN are all in place, so Ozi can ring his phone.
