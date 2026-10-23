# The company inbox, staff calls and the codes that authorise them

Decided by Anthony on 23 October 2026, recorded as ruling 77 in docs/BUILD_PROMPT.md. It builds on in-app calls (rulings 30, 37 and 46), ringing a phone through LiveKit (ruling 63), the admin panel and the team (rulings 38 and 43) and Ozi's desk (ruling 74, docs/changes/ozi-desk.md).

## Why

The company needs a way to reach any account, and for the account to answer, without anybody sharing a telephone number. Anthony also wanted to be sure that nobody on the team messages or rings a customer at will, that every message and call can be traced to a person and to whoever allowed it, and that calls are recorded, as the law allows when people are told.

## Messages

Ozi Delivery, meaning the owner and the staff, can write to any Shopper, Runner, Shop Partner or organisation, and they can reply. Accounts never message each other this way: every conversation is between the company and one account. Each account has one conversation, and each message keeps who sent it (the staff member's id and name, or the person on the account), the words, when it was sent and when it was read. The tables are new (migration `20261031090000_company_inbox`, in both repositories).

Every account has a Messages page, reached from its own main page: for a Shopper, from More and from the bar at the top of the screen; for a Runner, from the Runner page; for a Shop Partner and an organisation, from their dashboards. Each link shows how many messages are new. The page lists the messages, with the new ones marked in words, and has a reply box, with a button to say the reply instead of typing it. Ozi reads the messages aloud when asked ("read my messages"), marks them read, and offers to take a reply by voice, reading it back and sending it only after a yes.

When a message is sent, the account is told by a notification if they have notifications switched on. Otherwise a text goes to their own number, saying only "You have a new message from Ozi Delivery. Open the app to read it." (the product name comes from the configuration). The words of a message are never put in a text.

A reply from an account appears in the admin panel's new Messages tab, in the People group, with how many replies are unread, and it becomes a matter on Ozi's desk, to hear, so the owner is told about it on Ozi's next call.

## Codes: nobody messages or rings at will

Every message from a staff member needs to be authorised. The owner, and any staff member the owner lets authorise, can issue codes in the Messages tab. Only the owner decides who may authorise, in Team, with a button beside each person.

A message code is six numbers, works once, works only for the staff member it was issued to, and lasts two hours (`companyContact.messageCodeMinutes` in config/store.json). When a staff member presses Send, the panel asks for the code; without a valid one, nothing is sent. The owner and those he lets authorise send without a code.

A staff member without a code can press "Ask for a code" instead. The message is kept, held, and a matter goes on Ozi's desk: "Staff member Chidi asks to send a message to Runner Tomasz: the first words of it." Ozi adds "Press 1 to approve, 2 to decline, 3 to decide later". Approving, by the keypad on Ozi's call or in the admin panel, sends that message straight away, with no code. The person who asked cannot approve it themselves; only the owner or someone he lets authorise can.

Calls need a daily call code: one for each staff member each UK day, issued by the owner or an authoriser, six numbers, typed once, and then good for that staff member's calls until midnight, UK time. Issuing a new one for the same person stops the old one. The owner and authorisers need no call code.

Codes are kept only as keyed hashes, never as the codes themselves, and are never written to any log or to the audit log. Five wrong codes in a row make that person wait fifteen minutes.

## Calling anyone through the app

Staff can call a Shopper, a Runner, a Shop Partner or an organisation from the Messages tab, through the same LiveKit calls the orders use. The account is rung in the app ("Ozi Delivery is calling"), with a notification on a Shopper's devices, and their main pages show the call while it rings. If it is not answered in the app within about half a minute, the panel rings their own phone through the LiveKit SIP route (ruling 63) when that is set up; there is also a "Ring their phone instead" button. The account sees the company's number, never a staff member's own, and the staff screen is never shown the account's number.

At the start of every staff call both sides are told "This call is recorded": the account's screen shows it and Ozi says it, and the staff screen shows and says it too. For a call to someone's own phone, the staff member is reminded to say it when they answer.

## The call log and recordings

Every staff call is logged: who called (the staff member's name), whom (the kind of account and its name), when it started, whether it was answered, when it ended, how long it lasted, and its recording if there is one.

Recording uses LiveKit Egress, recording the sound of the whole call into S3-compatible storage, when the five settings RECORDING_S3_ENDPOINT, RECORDING_S3_BUCKET, RECORDING_S3_KEY, RECORDING_S3_SECRET and RECORDING_S3_REGION are all set. DigitalOcean Spaces works. Without them the call still works, and the log says "not recorded: recording storage not set up". Recordings are kept 90 days (`companyContact.callRecordingDays`) and then deleted by the retention sweep; the call stays in the log, saying the recording was deleted. Only the owner and those he lets authorise can play a recording, through a link that works for five minutes.

Messages are kept for as long as the account exists, and are deleted with it when the account is removed under the existing closing and erasure code. A removed account's calls stay in the log without its name.

## The messages and calls log

The Messages tab has a "Messages and calls log": every message and call by staff, newest first, with the date and time, the staff member, the account, and whether a code (and whose) or a desk approval authorised it, or the sender needed none. The owner and authorisers see everybody's; everyone else sees their own. Everything also goes into the audit log, in plain words, without the words of the message and without any code.

## The privacy page and the terms

The privacy page has a plain paragraph on messages from the company, how people are told about them, and calls being recorded and kept 90 days, and "How long we keep it" says so too. The terms say in one sentence that the company may contact account holders through the app.

## For Yvette: recordings

1. In DigitalOcean, create a Space (Spaces Object Storage, about $5 a month), for example in London (lon1). Keep it private (file listing restricted).
2. Under API, Spaces Keys, create a key. It shows an access key and a secret once.
3. In the API component's settings in App Platform, set RECORDING_S3_ENDPOINT to the Space's region endpoint (such as `lon1.digitaloceanspaces.com`), RECORDING_S3_BUCKET to the Space's name, RECORDING_S3_REGION to the region (such as `lon1`), and RECORDING_S3_KEY and RECORDING_S3_SECRET to the key, both as encrypted (SECRET) values.
4. LiveKit must already be set up (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET), with its webhook pointing at `/api/webhooks/livekit`, because the log learns that a call was answered and ended from it. LiveKit Cloud includes Egress; a self-hosted LiveKit needs its Egress service running.
5. For ringing phones, LIVEKIT_SIP_TRUNK_ID must be set, as for ruling 63.

## Tests

`packages/api/test/company-inbox.test.ts`: messages both ways, for a Runner, a Shop Partner and a Shopper; sending refused without a code; a code used once, only by the person it was issued to, and running out after two hours; the daily call code good until midnight UK time; the owner and authorisers needing none; the desk's yes (in the panel and on the keypad) sending a held message; texts and notifications without the message; the call log with stand-ins for LiveKit and the recorder; no storage meaning "not recorded"; only authorisers playing recordings; and the retention sweep deleting recordings after 90 days; with the storage link signed exactly as the published example. `packages/web/test/company-inbox.test.tsx`: the Messages page with its count and reply, for a Runner and a Shop Partner; Send asking for the code; "Ask for a code"; an authoriser sending at once; and the log. `packages/core/test/config.test.ts`: the configuration.
