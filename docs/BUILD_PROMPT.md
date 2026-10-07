# Ozi Delivery — Complete Build Prompt

30 September 2026, version two. From Anthony Tochukwu Ibe, the owner.

This supersedes ALL previous Ozi Delivery prompts, notes, figures and code comments. Where
anything conflicts with this, this wins. Do not reason from numbers or names found elsewhere.

> Kept word for word, with one change: the sentence that named the retired product name now
> says only that the old name is retired, so that this file does not bring it back. Anthony's
> answers given alongside it on 30 September 2026 are at the end.

---

## Section A — Identity and principles

**The name.** The product is Ozi Delivery. Ozi is Igbo for message. The old name is RETIRED.
Remove it from code, comments, variable names, database names, copy, filenames and commit
messages. Domain: ozidelivery.co.uk

**Vocabulary.** The customer is the Shopper. The deliverer is the Runner. Never "user",
"customer", "client", "driver" or "courier" in anything either of them sees.

**Who this is for.** Blind, partially sighted and elderly people first. Every decision is judged
against whether it works for someone who cannot see the screen. Accessibility is not a later
pass. It is the product. THE OWNER OF THIS BUSINESS IS BLIND. The admin panel is a primary
accessible surface, built to the same standard as the Shopper app.

**Icon rule.** Every icon carries its words underneath it. A plus symbol is never alone; it reads
ADD AN ADDRESS. For dyslexic users, users with learning disabilities, and first-time users. No
exceptions anywhere.

**Feel.** Premium finish. Smooth, unhurried scrolling. No jank. No sudden layout shifts, which
disorientate screen reader users. Text size adjustable and zoom supported on every surface.

**Accessibility gate.** Every screen must pass WCAG 2.2 AA. Every control reachable and operable
by screen reader and by voice. Large touch targets. High contrast. Nothing may depend on seeing a
colour, a position or a small icon.

## Section B — Pricing (ruled 29 September 2026)

**Standard delivery: thirteen pounds fifty, flat.** Replaces £8, £7.80, and every banded structure
of £8 to £12. There are no fee bands. There is no basket-linked fee.

**Maximum basket: sixty pounds.** Above it, Ozi says so in plain speech and offers to split into
two deliveries. The cap is operational: £60 is four or five carrier bags, what one Runner can carry
on foot or onto a bus safely.

**Runner share:** £5 on every standard delivery, untouched, whatever the basket.

**Extra shop within one mile:** plus £2.50. £1.50 Runner, £1 platform.
**Extra shop beyond one mile:** plus £4.00. £2.50 Runner, £1.50 platform.

**Nearer shop:** where a nearer shop carries the item, Ozi names the saving in pounds.

**Business emergency runs:** £12 flat inside Medway. £8 Runner, £4 platform. Promise: 45 minutes
from call to item in hand. Record actual elapsed time on every run.

**Errands (time-based):** £13.50 covers up to 30 minutes, £5 to the Runner. Each further 15 minutes
adds £6, of which £4 goes to the Runner.

**Sending (flat):** £13.50 for one collection and one drop within the served area. £5 to the Runner.

**Handed to the person:** £2 at checkout, all of it to the Runner.

**Ozi Line:** £15 for 75 minutes, £25 for 180 minutes, £35 for 300 minutes, 12p per extra minute.

**In-app calls:** 5p per minute to the platform. A separate billing line from delivery fees and
extra shop charges. Track minutes per call.

**Tipping:** optional, 100% to the Runner, at checkout and for one hour after delivery. NO suggested
default amount. Ozi NEVER asks for a tip aloud. Pressuring an elderly Shopper for a tip is against
the purpose of this product.

## Section C — The services

Five, presented as five clear choices.

1. **Shopping.** Runner buys from listed shops and delivers.
2. **Errands.** Runner spends time on the Shopper's behalf: queuing at the post office, returning
   an item, dropping clothes at a charity shop, taking a parcel to a collection point, collecting a
   prescription once a pharmacy has signed up under its own procedures.
3. **Sending.** Runner carries something from one place to another: donations to a food bank,
   gifts to a church, or person to person within the served area.
4. **Business emergency runs.**
5. **Campus.** A remote payer buys locally for a student. See Section J.

For errands starting at the Shopper's home, the clock starts at the door, not at the destination.

## Section D — Addresses and the PIN

**Registered home address.** Every account has one. It is the fallback for everything. Changeable
ONLY in settings, ONLY after the PIN. A VOICE ORDER ALWAYS DELIVERS HERE. No exceptions, whatever
else is saved on the account.

**Saved addresses.** Unlimited. No cap. Reasons: a parent with three children at different
universities; sending to a friend across town; a business or social media seller sending to
customers. Control is a plus symbol with ADD AN ADDRESS written underneath. Ozi announces the
control aloud when the page opens and can act on a spoken request to add an address.

**At checkout.** Offer the saved default first. Offer "send to a different address" beside it.
After a new address is entered, ask whether to save it or use it once only, the way a bank app asks
about a payee.

**The PIN, scaled to risk.**
- One-off address, this order only: touch confirmation, NO PIN.
- Saving an address permanently: PIN.
- Changing the registered home address: PIN.
- Any voice order: registered home address only, PIN irrelevant.

**PIN creation.** Prompted the first time the Shopper tries to add or change an address. NOT part of
signup — signup stays short.

**PIN rules.** Four digits. May be typed or spoken, Shopper's choice. Reject obvious PINs: 1234,
0000, four-digit years. Three wrong attempts then a timed lockout. Notify the account owner EVERY
time the registered home address changes, because a spoken PIN can be overheard.

**The spoken address confirmation — hard rule.** Before EVERY order, of every type, Ozi says the
delivery address aloud and waits for a yes. Not a summary. Not "your usual address". The actual
address. This prevents the most likely real-world error: an order intended for one person going to
another.

## Section E — Voice

**The voice layer is a separate product.** Called Oluoma Voice, in its own repository. Do NOT build
speech recognition or synthesis inside Ozi. Build a clean documented interface Ozi calls, so the
engine can be swapped without touching Ozi.

Interface needs: start listening, stop listening, return recognised text, speak given text,
interrupt speech, report readiness, accept a language parameter.

**Interim:** use the phone's own speech recognition and voice behind that interface until Oluoma
Voice exists.

**Voice character** (to specify to the Oluoma Voice build). Mid to high pitch, not deep, not thin.
Clear newsreader delivery, even pacing. Do not clone any existing commercial assistant voice.

**Default behaviour.** Ozi speaks aloud by default, always, from first launch. The product is for
people who cannot see the screen, so silence is the wrong default. A mute option exists in SETTINGS
for sighted users. It is found, not offered. Ozi does not ask whether the user wants it muted.
After the wake word, Ozi stays in listening mode so the exchange is a conversation back and forth,
not separate commands.

**Full voice ordering.** The whole order must be completable by speech alone. Example: "Hey Siri,
open Ozi Delivery." Then "Hey Ozi, place an order of bananas, grapes, apples and oranges from
Iceland, or the nearest available shop." Ozi asks quantities for each. Ozi reads back the full
basket and total. The Shopper confirms. The stored card is charged.

Confirmation may be by voice OR touch, the Shopper's choice.

**Voice payment ceiling.** A payment confirmed by voice alone is capped at EIGHTY POUNDS. Above £80,
touch confirmation is required. Reason: a voice can be duplicated, so the loss from a spoofed voice
must be bounded. Make the ceiling a configurable setting, default £80.

The combined effect of the ceiling and the locked address is that a hijacked voice can at worst buy
£80 of shopping and have it delivered to the account holder's own front door.

**Ozi explains itself.** Shoppers will not discover these features alone. While the app is active,
Ozi mentions its own functions from time to time in plain speech, spaced to inform rather than nag.
Frequency configurable and switchable off.

**Language module — build now, not later.** Do not hard-code English strings anywhere. Launch:
English and Welsh. Then Igbo, Hausa, Yoruba, Swahili. Structure so further languages are a content
task, not a code task. Covers displayed text AND spoken output, on every surface including the
admin panel.

**Accent.** Do NOT build an accent selector for recognition. Accent is handled by model quality, not
a switch, and a selector burdens the users it claims to help. DO offer two or three output voices
per language in settings beside the language selector. A Nigerian Shopper may prefer Nigerian
English to received pronunciation.

## Section F — Calling

Use Apple CallKit on iOS and ConnectionService or a full-screen intent activity on Android. Not
optional — the system call frameworks are what give the behaviour below.

**Ringing.** Incoming calls ring out loud using the phone's own ringtone and display the full-screen
native call screen on the lock screen and when unlocked, exactly as WhatsApp does.

**Answering by voice.** On iOS, because the call is reported through CallKit, the system treats it
as a real call. With the phone locked the Shopper can say "Hey Siri, pick up the call" and Siri
answers it. Build so this works, and default answered calls to LOUDSPEAKER. On Android,
additionally support "Hey Ozi, pick up the call" through Ozi's own listener, which Android permits.

**Permissions.** At installation, request the permissions needed for calls on the lock screen and
when unlocked, explaining in plain speech why each is needed.

**The call button.** A large round green call button, WhatsApp style, on both the Shopper side and
the Runner side. Large enough to find without hunting. Ozi also offers it aloud: "Do you want to
call the Runner, or just press the button."

**The call panel.** Once connected: END CALL, MUTE, LOUDSPEAKER, MERGE. Build MERGE now, not later.
It lets a carer or relative join as a third party, like a conference, to speak on the Shopper's
behalf.

**No telephone numbers anywhere.** No Shopper ever sees a Runner's number and no Runner ever sees a
Shopper's number. No number in any screen, notification, email or shared database field. All
contact goes through the in-app call.

## Section G — Live order status

Once an order is picked up, a live status page is reachable from the home screen on BOTH sides, and
must be obvious, not buried.

**Shopper sees:** that the Runner is active and on the move, the current stage, and an ETA that
updates.

**Runner sees:** a matching page about the Shopper showing ONLY what the Shopper has declared, such
as blind or partially sighted, plus what is needed to complete the handover.

The large green call button sits on both versions.

Ozi announces status changes aloud when the app is in the foreground. Push notifications at each
stage for when it is not.

**Concurrent ordering.** While an order is active, the Shopper must still be able to place another
quick purchase. The active job continues and stays visible. Do NOT block the ordering flow behind
an in-progress job.

## Section H — Substitutions

The Runner reaches the shelf and the item is not there. This happens on a large share of grocery
orders.

**The rule.** The Runner opens the in-app call. The Shopper decides. If the Shopper cannot be
reached, the item is NOT bought and is refunded. NEVER a silent substitution. NEVER a Runner
guessing.

Build: a substitution prompt in the Runner app that starts the call in one tap, records the outcome
against the order line, and adjusts the total before payment is taken.

## Section I — Scheduled orders and reorder

**Scheduled orders.** The Shopper can place an order for a future time or a recurring slot. Elderly
Shoppers live by routine, and "Tuesday morning" is worth more to them than speed. Settable and
cancellable by voice.

**Reorder.** "Same as last week" places the whole previous basket. Order history browsable and
speakable. For a repeat weekly shop this is the single most useful function in the app. Make it
prominent and make it work by voice.

## Section J — Campus

**The model:** the parent does NOT send a box. The parent pays, an Ozi Runner buys locally, and it
goes to the hall of residence the same day. This is Shopping with a remote payer. No long distance
carriage, no new capability, no new price. £13.50 plus goods.

The long-distance parcel version is rejected: Evri and Royal Mail already carry a parcel for around
£5.

**Why it is local:** Universities at Medway is a shared campus at Chatham Maritime run jointly by
Greenwich, Kent and Canterbury Christ Church, with several thousand students. University of Kent
students are housed at Liberty Quays, in Gillingham itself.

**The advantage:** Royal Mail, Evri and DPD all prohibit food and perishables. A parent sending
their child cooked food or fresh groceries cannot use any of them. Ozi can.

**Payer and recipient are different people** at different addresses. Handled by Section D:
touch-confirmed orders may use a second address; voice orders never do.

Campus demand is seasonal. Treat it as a supplement, never a foundation.

## Section K — Sending rules and contents

**The contents rule.** The sender SHOWS the Runner what is being sent. Not an inspection, not a
search — an open box or bag at the door. The Runner records the contents the way the
handed-to-the-person photograph is recorded: geotagged and transmitted at the moment of capture.

A declared contents list accompanies every sending job. The sender is responsible for the legality
of what is sent. This is how every carrier allocates it.

**Ozi will not carry:** Cash. Medicines, unless a signed-up pharmacy job under that pharmacy's own
procedures. Alcohol. Explosives and fireworks including
Christmas crackers. Flammable liquids. Aerosols and compressed gases. Illegal drugs. Firearms and
weapons including replicas and knives. Loose lithium batteries. Tobacco. Anything the sender will
not show the Runner.

A Runner may decline any sending job without giving a reason and without penalty.

**The size rule.** If it does not fit in the boot of a saloon car, Ozi does not carry it. Write this
into the terms and conditions in those words.

**Police reporting.** Where drugs, weapons or counterfeit goods are found, the carrier is legally
obliged to report to the police. Build a procedure for a Runner who opens a package and sees
something wrong. The procedure protects the Runner FIRST. No Runner is ever expected to challenge a
sender at the door.

## Section L — Handed to the person

£2 at checkout. All of it to the Runner, because they may have to wait and waiting cannot be
hurried.

**Evidence:** the recipient's first name, plus a photograph of the items in the doorway with the
recipient present.

The photograph is geotagged with location and exact time and TRANSMITTED TO THE SERVER AT THE
MOMENT OF CAPTURE, not uploaded later. Immediate transmission is the point: it cannot be altered
afterwards, which makes it evidence rather than a photograph.

If the recipient declines a photograph, accept without argument. The exact handover time plus the
first name stands as the record.

No signatures. No identity checks.

## Section M — Runner app

**Safety / SOS.** A large SOS button that shares live location. A lone Runner going to a stranger's
door currently has nothing. Standard on every driver app and not optional here.

**Earnings.** The Runner sees what they have earned, per job and cumulatively, clearly and without
hunting.

**Job offers.** Accept or decline, with the pay and the distance shown before accepting.

**Navigation** to pickup and to drop.

**Offline tolerance.** The Runner app must degrade gracefully on poor signal and sync when it
returns. Do not lose captured evidence because signal dropped.

**Who pays when something goes wrong.** Refunds, damage, wrong items and split bags are borne by the
PLATFORM, not the Runner, unless the Runner was negligent. Build refund handling on that basis. Do
NOT build any mechanism that deducts an incident from a Runner's payout automatically. A Runner who
fears paying for accidents will avoid difficult jobs, heavy baskets and awkward addresses — exactly
the work Ozi exists to do.

**Hire and reward insurance.** Ordinary private car insurance does not cover carrying goods for
payment. Hire and reward cover is the statutory minimum. Build a field that records and verifies
it, and block a Runner from accepting car-based jobs without it. Does not apply to walking or
public transport Runners.

**Cool box.** Funded at £1 from each of the first ten payouts per Runner, returned to them on the
twentieth delivery.

## Section N — Shops

Listing is FREE. Shops have no login, no app, no device, no training. Orders reach a shop by the
Runner walking in and buying as an ordinary customer. DO NOT BUILD ANY SHOP-FACING SYSTEM.

Listings are entered manually at a desk from doorstep cards holding shop name, address, telephone,
owner or manager name, and a dated agreement to be listed.

Prices arrive by WhatsApp as a photo, a voice note or typed text, and are entered manually.

EVERY DISPLAYED PRICE SHOWS THE DATE IT WAS LAST UPDATED.

No product photographs in version one.

**No white label.** Ozi's name is visible on every Medway delivery. Do not build any white-label,
unbranded or partner-branded path.

## Section O — Feedback and advertising

**Feedback.** Collected after delivery. Shops see PATTERNS ONLY: how many raised a theme, how often.
Never who said what. Never traceable to an individual. Reward leaving feedback of ANY kind with
delivery credit. NEVER make a reward conditional on the feedback being positive.

**Unmet demand.** Record every Shopper search for an item no listed local shop carries. Store item,
count, area, period. Internal data only. No dashboard, no external feed.

**Local voice advertising.** A paid mention NEVER changes a recommendation. The genuine
recommendation comes first, the paid mention afterwards, clearly labelled as an advertisement. Ozi
states only checkable facts: nearer, cheaper, in stock. NEVER "better". Charge roughly £1 per
delivery that results from a mention, not per mention and not monthly. Track attribution from
mention to completed order.

## Section P — Region and marketplace

Every region is a separate marketplace, INCLUDING regions with no listed businesses.

A region selector exists from day one. Only Medway is live at launch. Build the architecture for
many regions now.

When a Shopper's location changes region — Gillingham to Morocco, or to Nigeria — the app offers or
performs a marketplace switch. Whether it is automatic or on request is a Shopper-controlled
setting. Default: automatic for business accounts, ask first for personal accounts.

## Section Q — The admin panel

A full product surface, not a dashboard bolted on. The owner is blind and will run the whole
business through it.

**Platforms.** Works on laptop and on phone. Same capability on both, laid out for each.
Apple-premium finish, smooth scrolling, adjustable text size, zoom.

**Accounts and roles.** An OWNER account with powers nobody else has. Named STAFF accounts, each
with its own login credentials, added remotely by the owner. First staff account: Precious.
Role-based permissions so each member of staff sees what their job needs and nothing more. Instant
revocation: the owner can disable a staff login in seconds. Two-factor authentication on every
admin login without exception. Real money moves through this panel.

**What only the owner can do.** Open an individual Shopper's account. Add, edit or remove staff
accounts and permissions. Change pricing. Issue refunds above a set threshold. Export data.

**Audit log — mandatory.** Every administrative action logged with who did it, what they did, and
when. Refunds, account access, price changes, staff changes, exports. Immutable and viewable by the
owner only. This exists so a dispute between staff can be settled, and so the business can answer
the Information Commissioner if a Shopper complains that their record was accessed.

**What the panel shows.** Live and historical orders across all five services. Runners: who is
active, who is available, earnings, jobs completed. Shops: listings, price freshness, who has not
updated recently. Money: taken, paid out to Runners, platform share, Stripe fees, refunds issued,
call minutes billed. Signups: Shoppers and Runners, by period. Cancellations and refunds with
reasons. Feedback, as patterns and as individual records where permitted. Unmet demand records.

**Voice control of the panel.** The owner can open the panel by voice and ask it questions in plain
speech. Examples that must work: "What's happening?" "How many orders today?" "How much have we
taken this week?" "How many signups this month?" "What refunds went out yesterday and why?" "How
many Runners are active right now?" "Read me the cancellations."

Answers must be specific and backed by the actual data, never vague and never estimated. If the
panel does not know, it says so.

**Spoken answers and privacy — hard rule.** Spoken answers give NUMBERS, TOTALS AND PATTERNS ONLY.
Anything naming an individual Shopper, Runner or address requires the screen and an explicit
on-screen action. Reason: the owner may ask a question in a public place, and a panel that reads a
Shopper's name and address aloud on a bus is a data breach.

The panel follows the same icon rule, the same contrast and target sizes, and the same WCAG 2.2 AA
standard as the Shopper app.

## Section R — Data, payments, launch gates

**Personal data.** Strip personal data at the point of collection, BEFORE storage, not afterwards.
Replace rather than delete so sentences still read naturally. Test the stripping with Igbo, Hausa,
Yoruba and other non-English names, because detection trained on English names will miss them.

**Payments.** Stripe, Flutterwave and Paystack, all in version one. Flutterwave has a £250 ceiling.

**VAT — not yet settled.** Whether Ozi is principal or disclosed agent on the goods is with the
accountant. Record the goods value and the Ozi fee as SEPARATE amounts throughout, so either
treatment can be applied without rework. Do NOT hard-code a VAT treatment on the goods.

**Launch gates.** Stripe moved from test keys to live keys. Development database moved to a managed
database with backups. Full accessibility pass with NVDA, VoiceOver, axe and WAVE, covering the
admin panel as well as the Shopper and Runner apps.

## Section S — Build order

**First, and these are the product:** Section E voice layer interface and voice ordering. Section F
calling. Section G live status. Section D addresses and PIN. Section H substitutions.

**Second:** Section B pricing across all five services. Section Q admin panel, including accounts,
roles, audit log and voice queries. Section L handed to the person. Section I scheduled orders and
reorder. Section M Runner app including SOS.

**Third, and it is acceptable to launch before these are finished:** Section O feedback, unmet
demand and advertising. Section K sending rules beyond the basic contents rule. Section P automatic
marketplace switching.

**Roadmap only — record, build nothing:** Braille output. Haptic and vibration alerts. Integration
with a handheld Sonara device. A wrist band that tightens or pulses on an incoming call.
Braille in full, for people who are deafblind, is set out in ruling 40 below.

---

## Anthony's answers, 30 September 2026

1. **Pricing:** £13.50 flat, maximum basket £60, Runner £5 always. No fee bands, no basket-linked
   fee. The £2 floor and Rule Three are superseded.
2. **Voice engine:** use the phone's own speech recognition and voice as a stand-in BEHIND the
   Oluoma Voice interface, swappable later. The spelling is O-L-U-O-M-A. Do not tune ordering logic
   around the stand-in's recognition mistakes; they will not exist in the real engine, which uses
   Faster Whisper and is far better on Nigerian, Welsh and Kentish accents.
3. **Calling provider:** LiveKit.
4. **The rename pull request (#14):** merge it before starting.

## Rulings since, 1 October 2026

1. **No alcohol in version one.** Section K above is corrected: the clause "where the recipient
   cannot prove their age" is removed, and alcohol is on the absolute prohibited list alongside
   cash, medicines and tobacco. Section L stands unchanged: no signatures, no identity checks,
   ever. Reason: age verification is an identity check, and handovers must stay quick and
   non-intrusive. Alcohol also carries licensing obligations not confirmed with Medway Council.
   Revisit only if that changes.
2. **The working branch keeps its name.** Renaming it would break links in past pull requests,
   and the name is not visible to anyone.
3. **Ozi on first launch, and Ozi's button** (given by voice, 1 October 2026):
   - **First launch: Ozi speaks, with no notification.** Loud and clear, from setup. It
     introduces itself as designed to speak with the Shopper and have a conversation; says that
     to stop it speaking aloud they can turn it off in Settings; says how to pause its listening
     and how to bring it back; and says its button can be moved.
   - **The button.** A big round green button, glowing ("beaming") while Ozi is actively
     listening. On every screen, starting at the middle of the right-hand edge, big enough to
     see, out of the way of the screen. It can be moved: hold it and drag it (and, for keyboard
     and screen reader users, the arrow keys). Ozi tells the Shopper it can be moved.
   - **Muting.** Pressing the button, or saying "Ozi, mute", mutes Ozi: it stops listening. The
     button then changes so it is plainly not the bright green it was — and not by colour
     alone, for people who do not see colour well. Pressing it again brings Ozi back.
   - **Gentle reminders while muted**, so nobody thinks Ozi is listening when it is not: after
     two minutes, again three minutes later (five in all), and every three minutes after that —
     "I'm still here, but muted and not listening; press my button when you want me", in Ozi's
     own gentle words.
   - **"Hey Ozi"** brings Ozi back, where the voice engine can hear the wake word on the phone
     itself without listening to anything else. A muted Ozi must not be listening to anybody's
     conversation, so with the browser stand-in, which cannot do that, the button brings it
     back, and Ozi only promises what works. Oluoma Voice is asked for an on-device wake word
     (docs/OLUOMA_VOICE.md).

## Section T — Approved additions, 1 October 2026

Proposed by Claude Code and approved in full by Anthony on 1 October 2026: "add all your ideas".
Each one keeps every rule above. Where a price is given it is a proposal for Anthony to confirm;
nothing is charged until he does.

**T1. Family and carer plan.** A relative or carer, invited by the Shopper, gets their own view:
live order status, a spoken weekly summary, alerts. They can top up a budget, approve anything
over a limit the Shopper sets, and join calls through MERGE (Section F). The Shopper invites them
and can remove them at any time; the carer sees only what the Shopper allows, and never the
Runner's number. Proposed price: £3.99 a month. *Build:* second group, after calling (MERGE) and
the admin panel's accounts.

**T2. Councils and social care.** Medway Council adult social care, housing associations and
charities pay Ozi to serve their residents, including Shoppers paying from a personal budget or
Direct Payments. *Needs Anthony:* the conversations and contracts, and any provider registration
the council requires. *Build:* invoicing by organisation and the reports a commissioner asks for,
in the admin panel (Section Q). The data model already has organisations.

**T3. Delivery bundles.** Deliveries paid for in advance at a small saving. Proposed: four standard
deliveries for £48 instead of £54. Never time-limited pressure, never surge (Rule Four). The
Runner's £5 per delivery is untouched (Rule Two). *Build:* with Section B pricing.

**T4. Grants.** Innovate UK, the National Lottery Community Fund, the Thomas Pocklington Trust and
RNIB-linked funds. Non-dilutive. *Needs Anthony:* the applications. *Build:* nothing in the
product; Claude Code can draft applications from the build log and this document on request.

**T5. Sheltered housing rounds.** One Runner serves several Shoppers in the same building in one
trip: cheaper per drop, more per hour for the Runner, easy to offer to a housing scheme. Each
Shopper still pays the standard delivery and each still gets their own handover. *Build:* with
dispatch (Section M), extending the pooling the server already has.

**T6. A safe word at the door.** For every order Ozi gives the Shopper the Runner's first name and
a two-word code; the Runner says the code at the door. A blind Shopper knows the person knocking
is their Runner. Words are chosen to be easy to hear and say, never a number. *Build:* first group,
with live status (Section G).

**T7. A weekly spoken summary.** "This week you spent £38 on shopping. Your next delivery is
Tuesday morning." Spent, saved, what is booked; offered aloud once a week and on request, and
switchable off. A natural moment to offer "same as last week". *Build:* second group, with
scheduled orders and reorder (Section I).

**T8. An optional wellbeing check.** Only if the Shopper agrees, and only by a Runner who has
completed the safeguarding module (T11): a Runner who notices something worrying at the door can
raise it in the app, and Ozi tells the named contact the Shopper chose. Never a diagnosis, never a
report to anyone the Shopper did not name, except where the safeguarding procedure says a life is
at risk. *Needs Anthony:* the safeguarding procedure, reviewed by someone qualified. *Build:* third
group, after T11.

**T9. The landline, from the start.** A dedicated phone number, live from launch, for people
without a smartphone. A call comes into the central system and becomes a job like any other,
dispatched to the Runner best placed for the caller's address. Ozi Line (Section B) is how it is
priced. How Runners are offered jobs — for app orders and phone orders alike — is to be discussed
with Anthony before it is built; Claude Code is to bring a proposal. *Build:* first group, after
voice ordering, because a phone order is a voice order (Section E rules apply: the registered home
address, the spoken address confirmation, the £80 voice ceiling).

**T10. Receipts read aloud.** After delivery, Ozi reads the receipt: what was bought, what was left
out and why, the final charge, and the delivery fee as its own line (Section R keeps goods and fee
separate). Available again on request. *Build:* first group, with substitutions (Section H),
because that is where the final lines are settled.

**T11. Runner training.** Short, spoken-and-written modules, done in the Runner app, each with a
completion record. Some jobs are only offered to Runners who have passed the modules they need.
Modules: guiding and handing over to a blind or partially sighted person; the door safe word (T6);
the handover photograph and consent (Section L); substitution calls (Section H); food hygiene and
the cool box; lone working and SOS (Section M); sending — contents, refusals and the police
procedure (Section K); safeguarding and the wellbeing check (T8); data protection; hire and reward
insurance. Anthony's aim: it helps Runners develop, as well as do this job better. *Build:* second
group, with the Runner app (Section M); the safeguarding module before T8.

**Accepted as starting defaults, 1 October 2026.** Anthony: leave the suggestions as they are for
now, to be adjusted once running. So: the family and carer plan is £3.99 a month for each Shopper
looked after, cancellable any time, with up to three family members connected; it is paid by a
family member, the Shopper, or an organisation; all of it goes to the platform, never touching the
Runner's pay. Bundles are four standard deliveries for £48.

### Where they sit in the build order (Section S)

- **First group:** T6 door safe word (with G), T10 receipts read aloud (with H), T9 landline (after
  voice ordering in E).
- **Second group:** T1 family and carer plan, T3 bundles, T5 sheltered housing rounds, T7 weekly
  summary, T11 Runner training, T2 council invoicing and reports.
- **Third group:** T8 wellbeing check (after T11).
- **Not product work:** T2 contracts and T4 grant applications, which are Anthony's.

## Rulings, 2 October 2026 (given by voice)

1. **Who pays for a merged call.** The person who adds people to a call (MERGE, Section F) pays,
   from the card on their own account. They pay for their own minutes and for the minutes of every
   person they added. If the card cannot be charged at the time, the amount is kept as an
   outstanding balance and taken the next time their card is charged successfully. They are told.
   This applies to call charges only.
2. **Runners register themselves, entirely in the app.** No visit to the office. Quick and simple.
   Documents are photographed with the phone camera, not scanned, and the app makes sure each
   photograph is clear.
3. **The first screen asks who you are.** One app. Each choice has a short description under it,
   spoken aloud and written: Shopper, Runner, organisation, and the admin route.
4. **How a Runner delivers.** On foot, bicycle, motorbike or scooter, or car. On foot and bicycle
   need no insurance. A car, and a motorbike or scooter, need insurance. The Runner can switch at
   any time in their own Settings, for example from car to walking or bicycle, whatever the reason.
5. **The Runner's dashboard.**
   - What they have earned is big and bold, for today and over time.
   - A Training tab (T11).
   - Full job history, each job with its date, time, area, pay and a reference number linking it
     to the order and the Shopper, kept as long as the law allows.
   - Payouts: what has been paid out, and when.
6. **The DBS check.** Required if the law requires it; otherwise optional. Claude Code's reading
   is below, awaiting Anthony's decision.

### Proposed by Claude Code, 2 October 2026, awaiting Anthony

- **Wording on the first screen.** "Shopper", not "customer", keeping Section A's vocabulary.
- **Admin is not on the public first screen.** Staff sign in at a separate staff address, with
  two-step sign-in (Section Q). Public: Shopper, Runner, organisation, and "I look after someone"
  (the family and carer plan, T1).
- **Runner sign-up, in this order.**
  1. Name and phone number, confirmed by a text code.
  2. How you deliver: tick every option you might use, so switching later needs nothing new.
  3. A photo of your face. It is matched to your documents and shown to the Shopper at the door
     (T6).
  4. Right to work: a Home Office share code, or a passport photo for British and Irish citizens.
  5. A basic DBS certificate, or a share code for it.
  6. Car or motorbike only:
     - a photo of the driving licence, front and back, plus a DVLA check code;
     - the registration number, so MOT and road tax are checked automatically;
     - a photo of the insurance certificate showing business or hire-and-reward cover.
  7. Bank details through Stripe's own secure pages.

  While staff check the documents in the admin panel, the Runner starts training.
- **Switching how you deliver.** Switching down, to walking or bicycle, is instant. Switching to a
  car or motorbike needs valid insurance on file, and an expiry date triggers reminders. Only jobs
  that suit the current way of delivering are offered.
- **DBS.** For ordinary delivery work a DBS check is not legally required. But Ozi's Shoppers are
  elderly and disabled people, and Runners shop on their behalf and meet them at their door. In
  law, shopping for an adult because of age or disability can count as "regulated activity", which
  allows an enhanced check, and organisations and councils will expect one.
  - Proposed: a basic DBS for every Runner, mandatory.
  - An enhanced DBS, with the adults' barred list, before T5 rounds, T8 wellbeing checks and
    handovers to the person (Section L).
  - Anthony to confirm with a solicitor.
- **Records.** Order and money records are kept for seven years, beyond HMRC's six, then
  anonymised. Runners see an order reference, never the Shopper's name or phone number. Old jobs
  show only the area, such as "Gillingham, ME7", not the full address. The link from a reference
  to the Shopper is held only in the admin panel.
- **Payouts.** Weekly by default, through Stripe. A Runner can choose daily in Settings. Instant
  payout is available, with Stripe's small fee paid by the Runner and shown first. A new Stripe
  account has a short first-payout delay that Stripe sets.
- **Merged calls.**
  - Rule One applies: before a person is added, Ozi says the price ("adding someone costs 5p a
    minute for them, on your card") and waits for a yes.
  - A Runner never pays for a call (Rule Two).
  - An outstanding call balance above £10 is settled before more people can be added.

## More rulings, 2 October 2026 (given by voice)

7. **Problems and refunds: evidence from the Runner.** Each job in the Runner's account has its own
   "Report a problem" page. The Runner can send voice notes, type, and upload photographs and
   video as evidence, on their own, in the app. The admin panel (Section Q) has a tab where all of
   it arrives for review, with a deadline for each decision.
8. **Who pays, once decided. This amends Section M.**
   - The platform refunds the Shopper first.
   - If the Runner is found at fault, the amount is recovered from the Runner gradually: a small
     part of each job's pay, never the whole. Anthony's example is £1 from a £5 job, which is 20%,
     so the Runner still goes home with £4. It continues until the amount is repaid.
   - If the Shopper is at fault, there is no refund.
   - If the platform is at fault, the platform bears it.

   Section M's protection still holds in this form: nothing is ever deducted automatically. A
   deduction follows only a staff decision on the evidence, which is written down and given to the
   Runner, who can answer it.
9. **Switching how you deliver, restated.** A Runner registered with a car can switch to walking or
   bicycle at any time, instantly, with no insurance needed. Driving needs insurance.
10. **Everything is online, anywhere in the UK.** Nobody comes to an office.
11. **Runner ID, share button and feedback.**
    - Every Runner has their own ID.
    - A share button sends a personal invitation link to other people.
    - A feedback page lets Runners tell us things.
12. **A private referral reward (not announced yet).** When someone refers 100 people who have each
    made at least one purchase, they are rewarded. It is built and tracked in the admin panel,
    with a database of every referral, and told to nobody until Anthony says so.
13. **A database of everything that is not about a person.**
    - What products people buy.
    - Which shops they buy from.
    - What sells most.
    - What people ask for but cannot get.

    This is to build a model and to earn from insight, for example by showing a shop its demand.
    It must stay within UK GDPR and the Data Protection Act 2018.

### Proposed by Claude Code, 2 October 2026, awaiting Anthony (continued)

- **Refund timeline.**
  - Ozi acknowledges a report straight away.
  - Staff decide within 2 working days, 5 at the most.
  - A refund goes back to the card the same day it is decided. The law's limit is 14 days.
  - Items under £5 are refunded straight away without investigation. Investigating would cost more
    than the item. This is never counted against a Runner.
- **Recovery rate.** A setting, default 20% of each job's pay, subject to a solicitor's advice. If
  Runners count in law as "workers" in retail, the legal cap on deductions for stock deficiencies
  is 10% of pay per pay day. The deduction is in the Runner's written agreement from the start.
- **Referral reward.** £150 when 100 referred people have each paid for at least one order that
  was not refunded. Guards against cheating: a different card, phone number and address for each
  person, and nobody can refer themselves.
- **Data.**
  - Insight is sold only as aggregated figures. Every figure covers at least 10 different
    Shoppers, and no record about an individual is ever sold.
  - An analytics store separate from accounts: no names, phone numbers or full addresses, and
    postcode district only.
  - Health-revealing products are left out of anything shared outside.
  - The privacy notice says plainly that aggregated data is used commercially.
  - A data protection impact assessment, and registration with the ICO.

## Approved, 2 October 2026 (given by voice)

14. **Claude Code's ideas of 2 October are approved**: the Runner app design, the data and
    insight ideas, and the referral programme's shape. The specific questions still listed for
    Anthony stay open until he answers them.
15. **The recovery rate follows the law.** If the law caps it at 10%, it is 10%: 50p from a £5
    job, which Anthony is content with. Until a solicitor confirms that more is lawful, the
    setting starts at 10%.
16. **Every open question of 2 October is answered yes.** Each of these now stands as a ruling:
    - **Chains are listed by default.** Big chains (Asda, Aldi, Tesco and others) are listed by
      name without a dated agreement, because the Runner buys as an ordinary customer. There are
      no logos and nothing that suggests a partnership. Section N's dated agreement is still
      needed for anything beyond an ordinary listing (feeds, discounts, commission).
    - **Finding shops and products costs nothing per search.**
      - OpenStreetMap shop data for where shops are, hosted by us, with attribution.
      - A list linking items to the kind of shop that sells them.
      - Prices from Runners' till receipts, Open Food Facts and Open Prices, and entries made by
        hand.
      - Retailer feeds where they are offered.
      - No copying of supermarket websites, whether by Cowork, a crawler or a browser of our own.
    - **Ordinary calls.** In a call between a Shopper and a Runner, the Shopper pays the 5p a
      minute. A Runner never pays for a call.
    - **Merged calls.** An unpaid call balance above £10 is paid before more people can be added.
      Before anyone is added, Ozi says the price and waits for a yes.
    - **"Shopper" on every screen**, never "customer".
    - **Admin is off the public first screen.** Staff sign in at a separate address with two-step
      sign-in. The public first screen offers Shopper, Runner, organisation and "I look after
      someone".
    - **DBS checks.** A basic DBS check is mandatory for every Runner. An enhanced DBS, with the
      adults' barred list, is needed before T5 rounds, T8 wellbeing checks and handovers to the
      person (Section L).
    - **Payouts** are weekly by default. A Runner can choose daily, or take an instant payout at
      Stripe's fee, which the Runner pays and sees first.
    - **Records.** Order and money records are kept for seven years, then anonymised. Runners see
      an order reference and the area only.
    - **Refunds.**
      - A decision within 2 working days, 5 at most.
      - The refund paid the same day it is decided.
      - Under £5, refunded straight away without investigation, and never counted against a
        Runner.
    - **Referral reward.** £150 when someone has referred 100 people who have each paid for an
      order that was not refunded, with the guards against cheating above. It is not announced.
    - **Data shared outside.** Every figure covers at least 10 Shoppers. Products that reveal
      health are never shared. No record about an individual is ever sold.
    - **A Runner who leaves owing money.** Anything under £20 is written off. Anything above that,
      they are asked to repay.

## Rulings, 2 October 2026 (later): paying with cards from home countries

17. **Shoppers in the UK can pay with cards from their home countries.** Many people in the UK
    still pay with a Nigerian card. The same should hold for Ghana, Kenya, Zimbabwe, Sierra Leone
    and other countries as Ozi grows, along with Europe and India. Flutterwave and Paystack are
    confirmed (Section R), and others can be added where a market needs them.

### Claude Code's findings and plan, 2 October 2026

- **Today the store refuses these cards itself.** `payments.supportedCardRegions` in
  config/store.json is UK and EU only. Stripe can charge most Visa and Mastercard cards from any
  country, so widening that list is the quickest step.
  - Nigerian naira cards are often limited or blocked by the issuing bank for spending abroad. So
    charging them in naira through Flutterwave or Paystack is the dependable route.
- **Coverage found, October 2026.**
  - Flutterwave: Nigeria, Ghana, Kenya, South Africa, Uganda, Rwanda, Tanzania, Zambia, Cameroon,
    Côte d'Ivoire, Senegal, Egypt and others, with mobile money such as M-Pesa and Ghana Mobile
    Money. Sierra Leone is partial. Zimbabwe is not confirmed.
  - Paystack (owned by Stripe): Nigeria, Ghana, Kenya, South Africa and Côte d'Ivoire, with Egypt
    and Rwanda joining. It signs up businesses registered in those countries, so it may need a
    company registered there.
  - Zimbabwe's own gateway is Paynow (EcoCash, ZimSwitch). Zimbabwean Visa and Mastercard cards
    go through Stripe.
  - Europe: Stripe covers cards and the local methods (iDEAL, Bancontact, BLIK, SEPA, Klarna).
  - India: Indian cards go through Stripe. UPI needs an Indian-registered business (Razorpay, or
    Stripe India), so it waits until Ozi goes to India.
- **Order of priority by people in the UK (Census 2021).**
  1. Nigeria, about 271,000.
  2. Ghana, about 136,000.
  3. Kenya, about 135,000.
  4. Zimbabwe, about 124,000.
  5. Sierra Leone, far fewer.
18. **No restriction by card country (Anthony, 2 October 2026).** No law stops Ozi taking payment
    from cards issued abroad, so Shoppers pay with their local cards from anywhere. Ozi keeps adding
    payment gateways, beyond Stripe, Flutterwave and Paystack, wherever their terms can be met.
    - Mobile money such as MTN, Orange and EcoCash is wanted, because it is what people at home
      are used to.
    - Chinese Shoppers come later; Anthony will campaign hard among international students.
    - Reason: people in the UK, and abroad, pay for their families' shopping. Every payment goes to
      a third party (the shop), and orders are capped, so the service offers nothing to launder
      money through. Each gateway still does its own fraud and sanctions screening.

## Rulings, 4 October 2026 (given by voice)

19. **The motto is "Send me, I will help."** Ozi says it when it introduces itself, and it is shown on the first screen.
20. **Ozi speaks first.** On opening, Ozi introduces itself before anyone speaks to it: "Hello, I'm Ozi, your shopping assistant. Send me, I will help." Then it says how to turn talking off and back on, and that it will repeat anything. A browser will not let any website make a sound until the page is touched once. So on the website, Ozi's words are shown and read by a screen reader straight away, a big "Tap anywhere" notice appears, and the first touch anywhere makes Ozi speak. The phone apps have no such rule, and Ozi speaks with no touch.
21. **The round green button and a switch are on the screen from the start.** The switch sits at the bottom of every screen, so a sighted person can turn talking off. Ozi can be turned off by the switch, by saying "turn off" or "turn off talking", or in Settings. When turned off, Ozi says so, then says how to turn it back on: the switch, Settings, or "Hey Ozi, turn on". Turned off, Ozi is silent but still listens, so it can be turned back on by voice. Its words stay on the screen.
22. **Ozi repeats.** "Repeat", "say that again", "come again", "pardon", "I beg your pardon" and the like make Ozi repeat the last thing it said, worded differently each time. Then it asks "Did you hear that?". A question still waiting for an answer stays open.
23. **Telephone numbers are said in twos** ("zero one, six three, four eight"), twice. Ozi then offers a third time ("just say yes please, or repeat"). On the screen the number is spaced in the same twos.
24. **Opening an account is done by voice.** Ozi asks, "Would you like to open one now, just by talking with me? Just say yes or no." "Yes", "open account" or "start opening an account" starts it. Ozi asks for the name, mobile number, address and what to do at the door. It reads the number back in twos and reads back the address, fills in the form as it goes, and creates the account only after a final yes. There is no email or password; the mobile number signs the person in.
25. **A PIN can be tapped.** This is for somebody who cannot see the screen and has people around them. It sits beside typing it and saying it. Ozi guides one number at a time and says "Start" before each. One tap means one, up to nine taps for nine, and pressing and holding for a second means zero. Each tap gives a small buzz. When the taps stop, Ozi says it has the number, without saying it, and buzzes it back stronger and slower (one very long buzz for zero). One tap or "yes" keeps it; two taps or "no" does that number again. More than nine taps is not a number, and that number is done again. Choosing a PIN asks for it twice. An iPhone's browser cannot buzz, so there Ozi says so; the phone app can.
26. **No PIN to place an order** (4 October 2026, later). An order by voice or by screen goes through after Ozi reads the list back and hears a yes, so nobody has to handle the phone. The safeguard is the address: an order can only go to an address already saved, and saving or changing an address always needs the PIN, typed or tapped. That rule never changes.
27. **Landlines are accepted** as the account's phone number. A sign-in code can be spoken by an automatic phone call as well as sent by text, but only to a number already on an account. A shared phone has "sign me out" and "change account" by voice.
28. **Ordering by telephone.** The Twilio number is answered by Ozi. Ozi greets the caller, asks their name and surname, and asks to save their number, giving the reason first ("just in case this call gets cut off, I'll call you back"). It calls back if the call drops. It reads the order back slowly, asks "is that everything?", and gives the breakdown of the cost. A card is never spoken to Ozi. It is typed on the phone's keypad and goes straight to Stripe, and it only has to be given once, because later calls use the saved card after a yes. For callers who cannot use a keypad, the options are under consideration: a card added once by a family member or carer, or handing the payment step to a certified secure payment line (Claude Code's notes of 4 October 2026).
29. **No card, no order: a hard rule** (4 October 2026, final). Nobody places an order, in the app, on the website, by voice or by telephone, without a valid card saved with the payment gateway (Stripe, and later Flutterwave or Paystack), never with Ozi Delivery. The payment is taken before a Runner is sent. There is no paying at the door and no trial order. Anyone who cannot enter a card themselves, whether senior, blind (Anthony included) or otherwise, has a family member, carer or someone they trust enter it for them on the secure website or in the app. A spoken-card payment partner may be added later; until then, this is the only way. This replaces the pay-at-the-door idea.
30. **The landline number is from Plivo**, connected into LiveKit, so phone calls use the same calling system as in-app calls. Shoppers and Runners still only reach each other through in-app calls, never by number.
31. **Phone numbers are stored privately.** An account's number is kept while the account is open, because it is how the person signs in and how a dropped phone order is called back. It is used for nothing else, never shown to anyone, and deleted when the account is closed. The number of a caller who does not go on to have an account is deleted shortly after the call.
32. **Settings has a Sign out button**, alongside "sign me out" and "change account" by voice.
33. **Sign up with an email or a phone number, whichever the person has** (4 October 2026). Phone numbers keep the door open for people with no email, or who find email hard. Either way, the account is confirmed with a one-time code: by text or automatic phone call for a number, by email for an email address. Not built yet; the sending services are to be chosen (see Claude Code's handover notes of 4 October 2026).
34. **Ozi learns every day, with no AI model and no cost per conversation** (6 October 2026). Ozi's everyday phrases and replies live in `config/ozi-phrases.json`: about the app, shopping, delivery, Runners, healthy eating, and life in relation to shopping, never writing articles or anything outside its purpose. A scheduled Claude task adds to the file every day, using Anthony's monthly plan. It runs the full checks, and merges by itself only when nothing but that file changed and every test passes; anything else still waits for Anthony's "merge". The new phrases are also copied to a Google Drive folder Anthony can read and add to.
35. **Stripe only, for now**, plus Flutterwave and Paystack. Apple Pay and Google Pay are added, because they come through Stripe with no new account and no extra fee. Any other payment method Stripe offers with no new account may be added. Tofadachi Pay comes later.
36. **New ways to earn, built in this order** (6 October 2026, "ready on or before Friday"). First: Ozi Recipes, a paid extra (the Recipe Pass, £1.99 for 30 days from `config/store.json`, agreed before it is taken from the saved card, never renewing by itself; the recipe names and ingredients stay free to see); Little Gifts (ready-made, affordable gift bundles from the shop, never alcohol); and the weekly shop again ("same as last time", or "Order these again" on Past orders, which puts the last order back in the basket to change before ordering). Then: Ozi Finds It (a Runner checks up to three shops for something hard to find, for a small agreed finder fee, about £2); local same-day essentials instead of waiting for a parcel; gift cards; a family plan; Ozi Plus membership (about £7.99 a month); shop partnerships and offers; a weekly booked delivery; and contracts with organisations. Every price is agreed by the Shopper before it is taken.
37. **The rest of the new ways to earn, built together** (7 October 2026, "build all of them at once"). Ozi Plus (£7.99 for 30 days) and Ozi Plus for a family (£11.99 for 30 days, up to four people, joined with a six-letter family code): never renewing by itself, and never changing the delivery fee, because Rule Four forbids a fee that depends on who the Shopper is; Plus includes Recipes and the Ozi Finds It fee instead. Ozi Finds It: a person looks in up to three shops for £2, agreed first and given back if nothing is found; what is found goes in the catalogue, under "Found for you", to add to the basket; never alcohol, tobacco, medicines, cash or anything age restricted. Gift cards (£10, £20, £30 or £50): bought with a card, given as a twelve-character code, used once; on the next order the card is charged as agreed and the gift card money goes straight back to it once the order is paid. The weekly shop: a day of the week; on that day Ozi offers to put the usual shopping in the basket, and nothing is sent or paid until the Shopper says so (Rules One and Five). Offers: only offers agreed in writing with a shop, in `config/offers.json`, which starts empty; shops and organisations can ask to work with us by a form that lands in the admin panel. Everyday essentials (batteries, a charging cable, light bulbs) are brought the same day. All prices are in `config/store.json`.
38. **Each admin has their own sign-in, and sees only their job** (7 October 2026). Staff sign in to /staff with a username and a password they choose themselves at the first sign-in (stored salted and hashed, never as the password; five wrong tries waits fifteen minutes). Jobs: Founder (everything, and the only one who manages the team), Operations manager, Runner onboarding officer, Customer care officer, Finance officer, Finds It shopper and Partnerships officer, each seeing only its own tabs, checked by the server on every request. Every decision records the signed-in person's own name. The STAFF_API_KEY signs in as the founder. docs/STAFF_ROLES.md is the hiring guide. The app works fully on the phone's own voice; Oluoma Voice, Faster Whisper and LiveKit are improvements added later, and nothing waits for them.
39. **Ozi speaks to staff, everywhere in the admin panel** (7 October 2026), so a blind person can be employed in any job, the IT person included. When someone signs in, Ozi says who they are and what is waiting, by name ("2 complaints to decide, from Mr Table and Mrs Smith"). It reads any list aloud, one item at a time, with "next", "back" and "again"; moves between the parts of the panel ("read me the complaints", "look at the web mail", "any feedback"); and makes every decision by voice ("nobody at fault, refund 2 pounds 50", "accept", "write it off", "found it", "not found", "rung back"), each read back and done only after a yes. A job's limits apply by voice exactly as on the screen. Nothing said in the panel is ever taken as a shopping order. Passwords are typed, never spoken, so nobody nearby hears them. Every admin screen also works with a screen reader, and so with a Braille display.
40. **Braille, for people who cannot see or hear** (7 October 2026). On the roadmap, in this order; nothing here holds up the launch.
   1. **Today, already:** a Braille display connected to an iPhone (VoiceOver) or Android phone (TalkBack), by Bluetooth or a cable, reads and types in the app, because every screen is built for screen readers. Phones also have on-screen Braille typing of their own (Braille Screen Input on iPhone, the TalkBack Braille keyboard on Android). Write this up as a short guide, tested with a real display.
   2. **A deafblind mode:** everything Ozi says is also sent as text the Braille display shows, with no reliance on sound; confirmations by a key on the display or a tap pattern; vibration patterns for "your Runner is at the door" and "your Runner has a question".
   3. **A Braille connector:** our own connection for handheld Braille devices, by Bluetooth, a cable or any other link, straight to the app, so a deafblind person can place an order, and an open interface (API) other Braille device makers can use.
   4. **Ozi's own Braille pad:** a digital Braille keypad on the phone's screen for placing an order, brought up by a tap pattern on the screen or by saying a word (for people who can speak but cannot see or hear), and put away the same way.
   5. **A Braille pad of our own, as a device,** if the market and the technology allow, after the above.
41. **Shop Partners, and organisations with their own area** (7 October 2026). This changes Section N's "no shop-facing system". **Every shop is still listed free, by us, with no sign-in.** A shop that pays monthly becomes a **Shop Partner** (£29.99 a month, `extras.partnerMonthlyPence` in `config/store.json`). It gets its own sign-in, given by our partnerships staff, where it adds products with a photo (typed, or by talking to Ozi), changes prices at once, takes products off, sees what it pays, and shares a link to its own page in the app. Each new product is checked by a person before Shoppers see it; nothing restricted is ever listed. Products show only while the plan is paid. **Ozi mentions** ("Ozi Recommends") are a separate extra, only for Shop Partners. Claude Code's recommendation, awaiting Anthony: a flat monthly fee (Spotlight £19.99, mentioned at most once a week to the same Shopper, and only when they ask for something the shop sells; Spotlight Plus £39.99, up to three times a week plus the weekly local pick), at most three promoted shops per kind of product in an area, £19.99 for everyone for the first three months, then reviewed. Section O still applies: the genuine answer first, the mention after, labelled as an advert, checkable facts only. Choosing monthly replaces Section O's "about £1 per resulting delivery". **Organisations** (councils, care homes, hospitals, charities, businesses) have their own sign-in, each person with their office, and see: the people they support who chose to link to them (only the person links, with the organisation's code, after being told what it will see, and can stop it in Settings); every order with who it was for and their office; spending this month, last month and altogether; spending by office; budget left; savings worked out from their own figure for a staff trip to the shops; weekly shops booked; and a statement to download. Paying by invoice instead of each person's card is not built: it would change "no card, no order" and needs Anthony's ruling. Each kind of account has its own sign-in, and Ozi has each dashboard's own commands only, so it never mixes up a Shopper, a Runner, a Shop Partner, an organisation, the staff or the founder. A till's "ka-ching" sounds when money is taken, and falling coins when it comes back. The first screen's descriptions are in plain English, with a Shop Partner door. docs/GROWTH_PLAN.md says how the service grows to millions of users; docs/STILL_TO_DO.md lists what the blueprint asks for that is not built yet.
42. **Spotlight, statements, share links and business analysis** (7 October 2026). Approved: the Shop Partner plan is £29.99 a month, and Spotlight (£19.99 a month) and Spotlight Plus (£39.99 a month) are separate extras on top of it, only for Shop Partners whose plan is paid. On Spotlight, Ozi mentions the shop to a Shopper looking for something it sells at most once a week; on Spotlight Plus up to three times; one advert at most per search, after the genuine results, called an advert, with checkable facts only (Section O). Every payment a Shop Partner makes is recorded and listed in its area, and both Shop Partners and organisations download statements as PDF (organisations also as a spreadsheet). Shop Partners and organisations each have a share link and a meter showing how many people joined through it, towards 100. From day one, every purchase, delivery and search is recorded for business analysis with no names, numbers or addresses (people as one-way codes, places as postcode districts, an optional age group the person gives in Settings), shown to the founder and a new Business analyst role in an Analytics tab, with every group of fewer than ten people left out. docs/BUSINESS_ANALYSIS.md sets out the simple, medium and complex stages, what can be sold (insight about groups, never people), and the rules that keep it lawful.
43. **The owner's account, and who sees his dashboard** (7 October 2026). Only the owner's own account sees the money (every payment in and refund out, by gateway: Stripe now, Flutterwave, Paystack and others when connected), recorded in a ledger as each charge and refund happens. It signs in with a username, a password and a 7-character passcode, six numbers then a special character of his choosing, which he changes in My settings; two-step codes from an authenticator app can be switched on there. Not the staff key, not staff, not family, not investors, ever see the money. The owner adds family (such as his wife) and investors with their own sign-ins; everything starts off, and he switches parts on one by one or all at once (overview, business analysis, the team, documents, complaints, feedback, Finds It, enquiries, shops and organisations); they can look but never change anything. The kill switch, with the passcode, turns every family and investor switch off and signs every admin session out, his own included; nothing is deleted. A fingerprint can join the passcode later, in the phone apps. Business analysis is the founder's, and whoever he switches it on for (the Business analyst job is withdrawn). Pinch to zoom and pan works on the website and is switched on for the phone apps. An advert square is built, small, in the corner, called an advert, never on paying or card screens, never read aloud, hidden for Ozi Plus members who choose; it stays off until Anthony switches it on in `config/adverts.json`.
44. **Ozi's phrases for every account, kept on the server; "Mr Anthony"; share links for everybody; security** (7 October 2026). This changes ruling 34. Every kind of account has its own collection of everyday phrases and replies, written for it: Shoppers (`config/ozi-phrases.json`), and Runners, Shop Partners, organisations, staff, family members, investors and the owner (`config/phrases/<account>.json`), at least 50 each to begin with. The collections stay on the server and are never sent to the app: the app sends what was heard to `POST /ozi/reply` and gets one reply back, and which collection answers is decided by who is signed in, never by anything the app says. The owner's Ozi is first among them: it has his own phrases and every other account's. In the owner's admin panel Ozi calls him by the form of address in `config/phrases/owner.json` ("Mr Anthony"), says "Yes, sir.", "Okay, sir." or "All right, sir." when he asks for something, and ends what it says with "sir". The daily task adds 50 phrases a day to each account's collection, and no longer copies them to Google Drive or anywhere else: they are private. The recommended ceiling is about 5,000 phrases per account (about 40,000 in the owner's), reviewed at 2,000 per account, from when the daily additions switch to answering questions people actually asked that Ozi could not answer; not a million, because beyond a few thousand they repeat each other and make it harder to keep every answer right. Everybody signed in has a share link and a meter of how many joined through it: the owner, staff, family and investors in the admin panel, Shoppers in Settings (Runners, Shop Partners and organisations already had theirs). docs/SECURITY_PROPOSAL.md is the security plan, in plain words, including what a stolen account can and cannot reach, the one-way ("data diode") measures, and recovery; its first steps are built: security headers on every reply, and a limit on sign-in tries from one internet address.
45. **Twilio for both texts and calls; no Plivo** (7 October 2026). This changes ruling 30. Plivo does not accept accounts from our region, so one Twilio number does both: it texts sign-in codes, phones codes to landlines, and is the number Shoppers ring to order by telephone (ruling 28), connected into LiveKit so phone calls use the same calling system as in-app calls. The number is a UK mobile number (+44 7) with Messaging and Voice both switched on, registered to the company as a direct customer. Shoppers and Runners still only reach each other through in-app calls, never by number.
