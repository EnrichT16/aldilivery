# Legal review of the website's legal pages (ruling 54, 9 October 2026)

Anthony asked for a review of the legal pages against UK law, done by Claude Code instead of a
solicitor for now. **This is not legal advice.** It is a careful check against the law as it stood
in October 2026, written down so a solicitor can pick it up quickly later. Where the law is
uncertain, this says so.

## What was checked

The pages and settings, as they were on main at commit b3a6add:

| Page | Where | State before |
| --- | --- | --- |
| Privacy | `/privacy`, `packages/web/src/pages/Privacy.tsx` | Marked draft. Good start, but gaps (below). |
| Our terms (Shoppers) | `/terms`, `packages/web/src/pages/Terms.tsx` | Marked draft. Gaps (below). |
| Runner agreement | none | Missing. The app said "Runners will have their own agreement". |
| Cookies / device storage notice | none | Missing. |
| Refunds | a section of the terms | Kept as a section of the terms, now fuller. |
| Company details | footer, `config/store.json` | Only a placeholder company name. |

Against:

- **UK GDPR and the Data Protection Act 2018**: Articles 13 and 14 (who we are and how to reach
  us, ICO registration, each purpose with its lawful basis, special category data and its
  Article 9 condition, criminal records data and its Schedule 1 condition, recipients and
  processors, transfers abroad and safeguards, retention, rights, the right to complain to the
  ICO, automated decisions, children).
- **PECR 2003**, regulation 6 (storage on the device) and regulations 22 and 23 (marketing texts and
  emails, and the soft opt-in).
- **Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013**:
  pre-contract information (Schedule 2), the order button (regulation 14), the 14 day right to
  cancel and its exceptions (perishable goods, regulation 28(1)(b); services fully performed at
  the consumer's request, regulation 36), how to cancel, and refunds within 14 days.
- **Consumer Rights Act 2015**: goods of satisfactory quality, fit and as described; services with
  reasonable care and skill; no unfair terms (Part 2); no exclusion of liability for death or
  injury caused by negligence (section 65).
- **Electronic Commerce (EC Directive) Regulations 2002**, regulation 6, and the **Companies Act
  2006** with the **Company, LLP and Business (Names and Trading Disclosures) Regulations 2015**:
  company name, number, place of registration, registered office and an email address on the
  website.
- **Equality Act 2010**: the duty to make reasonable adjustments for disabled customers.
- **For Runners**: employment status (the Employment Rights Act 1996, *Uber v Aslam* [2021] UKSC 5,
  *Pimlico Plumbers v Smith* [2018] UKSC 29, *IWGB v Deliveroo* [2023] UKSC 43), deductions from
  pay (Part II of the 1996 Act, including the 10% retail cap in section 18), and whether the
  deposit and recovery wording is fair and clear.

The code was read to make the pages match what the app really does: Runner offers and declines
(`packages/api/src/routes/jobs.ts`, `services/allocation.ts`), pay, the cool bag deposit and
recovery (`services/pay-runner.ts`, `services/payouts.ts`), the till settlement (`services/till.ts`),
browser storage (`localStorage` and `sessionStorage` across `packages/web/src`), voice
(`packages/web/src/voice`, docs/OLUOMA_VOICE.md), analytics (`packages/api/src/lib/analytics.ts`),
telephone ordering, account deletion and the database schema.

## What was wrong, and what was changed

### Privacy (`/privacy`)

| Gap | Law | Fixed by |
| --- | --- | --- |
| No company number, registered office, email or ICO number | UK GDPR Art 13(1)(a) | A company details block from `config/store.json`; placeholders show "to follow". |
| One lawful basis for everything | Art 13(1)(c) | A reason given for each thing kept. |
| Door instructions often reveal blindness or disability (health data), with no Article 9 condition | Art 9 | Says it is kept on explicit consent, only to help at the door, and can be changed or deleted. The sign-up hint and Ozi's spoken question now say so at the point it is given. |
| DBS checks (criminal records data) had no condition named | Art 10, DPA 2018 Sch 1 | Names the safeguarding condition (Sch 1 para 18) and the written policy it needs. |
| Voice said "your phone turns speech into words; we never get the sound". Untrue since Oluoma Voice (ruling 53). | Art 5(1)(a), 13 | Now says sound goes to Oluoma Voice, is not kept, and the phone's own speech is the fallback; that muting stops listening but turning off talking does not. |
| Telephone ordering, notifications and security logs not mentioned | Art 13 | Added. |
| Some recipients missing (Twilio for calls, Oluoma Voice, Runners, organisations, HMRC) | Art 13(1)(e) | Added. |
| Transfer safeguards vague | Art 13(1)(f) | Names adequacy, the UK–US data bridge and ICO-approved contract terms. |
| Retention only for orders, accounts and documents | Art 13(2)(a) | Periods for every kind of record. |
| Rights listed partly; no portability, restriction or withdrawal of consent | Art 13(2)(b)-(d) | Full list, free, one month. |
| Automated decisions not mentioned | Art 13(2)(f), 22 | Says what is automatic (small instant refunds, Stripe fraud checks, the job rotation) and that a person decides anything that matters. |
| Children not mentioned | Art 8, ICO guidance | Adults only, 18+. |
| Platform reporting of Runner earnings to HMRC not mentioned | Art 13 | Added (the UK reporting rules for digital platforms, from 2024). |
| Marked "draft" | | Draft mark removed: the text now covers what Articles 13 and 14 ask. A notice lists the company details still to follow, and disappears when they are filled in. |

### Our terms (`/terms`)

| Gap | Law | Fixed by |
| --- | --- | --- |
| No company number, address, email | CCR Sch 2, E-Commerce Regs reg 6 | Company details block. |
| Cancellation said only "ring us before shopping starts"; nothing on the 14 days, the extras or gift cards, or how to cancel | CCR regs 29-36, Sch 2 | Full "Changing your mind" section: free until shopping starts; after that you pay for what was done; no change of mind once delivered or for fresh food; 14 days for Recipe Pass, Plus and unused gift cards; the words to use. |
| Till settlement (ruling 52) not explained | CCR Sch 2(c), CRA s50 | Explains the estimate, the refund of any difference, and the cap above which a person speaks to you first. |
| Extras' prices and that they never renew not stated | CCR Sch 2 | Added, from configuration. |
| Nothing about liability; nothing about death or injury | CRA s65, Part 2 | Plain liability section; never limits death, injury or fraud; no cap. |
| No accessibility or adjustments statement | Equality Act 2010 s20, s29 | "Help and adjustments" section. |
| No complaints route or age | | Added. |
| The confirm screen did not point to the terms | CCR reg 14, Sch 2 | One line and a "Read our terms" link above the order button. |
| Marked "draft" | | Draft mark removed, with the same "to follow" notice. |

### New pages

- **Runner agreement** (`/runner/agreement`, `packages/web/src/pages/RunnerAgreement.tsx`), linked
  from the Runner door and from Runner sign-up. Written to match the app: go on and off shift at
  will; decline any offer or let it lapse with no penalty and no loss of place in the rotation
  (true in `routes/jobs.ts`: declining does not change `lastJobCompletedAt`); work for others;
  £5 a delivery and £5 for each pooled order; the deposit; the 10% recovery only after a written
  decision by a person, which the Runner can answer; write-off under £20. **It stays marked as a
  draft on purpose** (see the risks below). *Since ruling 55 (9 October 2026) it also says how a
  Runner pays at the till and is paid back, carries its version date, and is agreed before the
  first job; it stays a draft only for employment status, a right of substitution and a
  solicitor's reading.*
- **What we keep on your device** (`/cookies`, footer link "Cookies"). Lists every item the site
  keeps in `localStorage`, `sessionStorage`, the offline copy and Stripe's cookies. All are
  needed for the service or remember a choice, so no consent banner is needed under PECR reg 6(4).
  To keep that true, the "which share link brought you" marker is now deleted as soon as the
  account is made (`registerShopper` in `packages/web/src/lib/api.ts`).

### Company details on every page

The footer now shows the company name, where it is registered, its number, registered office and
email on every page, always visible (not hidden behind "Show words on the screen").

### Configuration (`config/store.json`)

Company details stay configuration (Rule Nine), reusing the existing pattern of a value plus an
`...IsPlaceholder` flag:

- `store.legalEntityName` is now the company's name, and `legalEntityIsPlaceholder` is false.
- New: `store.companyNumber`, `store.registeredIn`, `store.registeredOffice`,
  `store.icoRegistrationNumber` and `contact.email`, each with its own placeholder flag. The parser
  in `packages/core/src/config.ts` requires them and checks the email address.
- `packages/web/src/components/CompanyDetails.tsx` shows them, and shows "to follow" for any still
  flagged, never the made-up value.

Neither the product's name nor the store's name is written in any source file; both come from
configuration, as before.

## What Anthony must fill in

In `config/store.json`, put the real value in, then set its flag to `false`:

| Field | Flag | What to put |
| --- | --- | --- |
| `store.legalEntityName` | `legalEntityIsPlaceholder` (already false) | Check it matches Companies House exactly, letter for letter, including "Ltd" or "Limited". |
| `store.companyNumber` | `companyNumberIsPlaceholder` | The 8-character number from Companies House. |
| `store.registeredIn` | none | "England and Wales" unless the company is registered in Scotland or Northern Ireland. |
| `store.registeredOffice` | `registeredOfficeIsPlaceholder` | Done (ruling 59): 107 King Street, Gillingham, ME7 1ER, flag false. The company is OZIDELIVERY LTD. |
| `store.icoRegistrationNumber` | `icoRegistrationIsPlaceholder` | After paying the data protection fee at ico.org.uk (about £52 a year for a small company). |
| `contact.email` | `emailIsPlaceholder` | A mailbox that is read every working day. The value there now is a guess. |
| `contact.telephonePlaceholder` | `telephoneIsPlaceholder` | The Twilio number Shoppers ring (Part 7, step 2). |

Also needed, outside the code:

1. **A written policy for criminal records and health data** (an "appropriate policy document"
   under the Data Protection Act 2018, Schedule 1 Part 4). The ICO has a template.
2. **A data protection impact assessment**, already on the list (ruling 16): blind and older
   Shoppers, health information in door notes, voice, location of Runners and DBS checks all call
   for one.
3. **Processor contracts**: accept each provider's data processing terms (Stripe, Twilio, LiveKit,
   DigitalOcean) and check each is on the UK–US data bridge list or uses the ICO's transfer
   addendum. Write down who runs Oluoma Voice and where; if a different company runs it, it needs a
   processor contract too.
4. ~~**Decide how a Runner pays at the till** (see the first risk), then replace that line in the
   Runner agreement.~~ **Done (ruling 55, 9 October 2026):** the Runner pays with their own card
   and is paid back straight away; the agreement says so.

## Code that must catch up with the pages

The pages now promise these; the code does not yet do all of them:

1. **Closing an account does not delete it.** `POST /account/delete` sets
   `deletionScheduledFor`, but nothing removes the account when the 7 days are up, and there is no
   "close my account" button. The pages say "ring us" for now. A daily job is needed.
2. **Retention periods** in the privacy page (problem evidence two years, check records two years
   after a Runner leaves, telephone numbers 30 days, analytics three years, security logs one year)
   need deletion jobs. Until they exist, they must be done by hand.
3. **The cool bag deposit on leaving.** The agreement promises to pay back what is held within 14
   days when a Runner leaves early. `pay-runner.ts` only releases it on the 20th delivery; staff
   must do it by hand until there is a button.
4. **Changing door instructions.** There is no screen for it yet; the page says "ask us".
5. **Rule Ten and the deposit.** The withheld deposit stays in the platform's Stripe balance until
   it is released, so for that time the service does hold Runner money. Either change Rule Ten's
   wording or hold the deposit differently. *Still open (9 October 2026): ruling 55 left the
   deposit logic unchanged on purpose, for Anthony to rule on. Paying a Runner back for the
   shopping does not add to it: that money goes straight out to the Runner's own account.*
6. **The order button.** Regulation 14(3) of the 2013 Regulations asks that the button which places
   an order says clearly that it means paying, such as "Order and pay". "Send my order" probably
   falls short, and the penalty is that the Shopper is not bound by the contract. The wording is
   fixed by Rule One in RULES.md, so it is Anthony's decision: **recommended: "Send my order and
   pay"**, and the same idea in the voice read-back ("Shall I send it and take the payment?").
   **Done (ruling 55, 9 October 2026):** the button reads "Send my order and pay", what the
   Shopper agrees to begins "Send my order and pay.", and Ozi asks "Shall I send your order and
   pay now, charging about £X to your card ending 1234?". Recorded as an amendment under Rule One.

## Remaining risks a solicitor would normally look at

1. **Employment status of Runners (the biggest risk).** The agreement and the app give Runners real
   freedom: no hours, decline anything without penalty, work for others. That points to
   self-employment. Against it: the pay is set by us, Runners cannot send a substitute, and we
   control how the job is done (door instructions, no swaps, training). After *Uber*, a tribunal
   looks at the reality, not the words. If Runners were found to be "workers", they would be owed
   at least the National Minimum Wage for working time (a £5 job that takes over an hour would be
   below it), holiday pay, and the protection of the deduction rules. A right to send another
   checked Runner (as in *Deliveroo*) would strengthen the position; so would letting Runners see
   and choose jobs rather than only being offered them. How Runners pay at the till matters here
   too: if they spend their own money and wait to be paid back, that is a fairness and status
   problem, and today the code pays only the £5, not the shopping (`pay-runner.ts`). *Since
   ruling 55 they are paid back the till total straight away when they put it in
   (`services/reimburse.ts`); only a till total far over the estimate, over the whole-order cap (£60 then; £150 since ruling 58, confirmed in ruling 59), or on an order
   the till itself needs a person for, waits for a person to approve, the same day where
   possible.*
2. **Liability caps.** The terms deliberately have no money cap on our liability to Shoppers,
   because caps in consumer terms are often unfair under the 2015 Act. A solicitor may want a fair
   cap for some losses, and a cap and indemnity in the Runner agreement.
3. **Insurance.** Public liability, goods in transit and employer's liability (needed if Runners
   are ever found to be workers or employees) are not yet in place (Part 7, step 11). Runners
   driving need hire and reward cover; we check it, but a claim against us is still possible.
4. **Who sells the goods.** The terms say a Runner buys the shopping for you and we are responsible
   for the service. Whether we are the seller (reselling) or an agent changes VAT, who is liable
   for faulty goods, and food law duties (food business registration with Medway Council may be
   needed for delivering chilled food). We take responsibility to the Shopper either way.
5. **Health data and organisations.** When a council or care provider arranges a Shopper's
   shopping, who is the controller needs a written agreement with that organisation.
6. **Marketing.** No marketing texts or emails are sent today. If any are added, they need consent
   or the soft opt-in (existing customers, similar products, an easy "stop" in every message).
   Ozi's spoken adverts (Spotlight) are in the app, not electronic mail, but must be labelled as
   adverts (they are) to meet consumer protection law.
7. **The 10% recovery.** Clear, in writing before any job, decided by a person on evidence, capped
   at 10% and never automatic. That is fair and transparent. It would still be a deduction a
   tribunal could look at if Runners were workers; the written agreement before the first job is
   what makes it lawful then, so the "agree before your first job" step must actually be built and
   recorded. **Done (ruling 55):** a Runner ticks to agree at sign-up, or on their Runner page
   (a spoken yes is accepted by the server too); the date, the version and how are kept on their
   account; no job is offered or accepted until they have agreed to the current version, and a
   new version asks everyone again.
8. **Age.** The pages now say 18 or over. Nothing checks it. That is normal for this kind of
   service, but Runners' DBS and right to work checks should include date of birth.

## Tests

`packages/core/test/config.test.ts` checks the new company fields and refuses a contact email
that is not an address. `packages/web/test/shell.test.tsx` checks that the privacy page and terms
are no longer marked draft, carry the company details, the ICO complaint route, explicit consent,
the cancellation section, the death and injury wording and the adjustments section; that the
footer carries the company details on every page; that the cookies page exists; and that the
Runner agreement matches the app (decline without reason, the recovery rate from configuration,
nothing automatic) and is still marked as a draft. Both new pages are in the axe accessibility run
(`packages/web/test/a11y.test.tsx`) and the every-control-named and 48 pixel checks.

## Updates, 9 October 2026 (ruling 55)

Anthony decided three of the open points:

| Item | Where | Status |
| --- | --- | --- |
| How a Runner pays at the till ("choice 1": their own card, paid back straight away) | `packages/api/src/services/reimburse.ts`, the receipt route in `routes/orders.ts`, the Runner agreement page | Done |
| The order button says "Send my order and pay" (regulation 14(3)) | `packages/web/src/pages/Confirm.tsx`, `state/voice-order.ts`, RULES.md Rule One | Done |
| Agreement to the Runner agreement recorded before the first job (makes the 10% recovery a written, prior agreement) | `packages/api/src/services/runner-agreement.ts`, `routes/jobs.ts`, `services/dispatch.ts`, Runner sign-up and Runner page | Done |
| Rule Ten and the cool bag deposit | `services/pay-runner.ts` | Unchanged on purpose; still for Anthony |
| Runner agreement draft marker | `packages/web/src/pages/RunnerAgreement.tsx` | Kept: employment status, a right of substitution and a solicitor's reading are still open |

Still worth knowing: the Runner types the till total and keeps the receipt; no photo of the
receipt is taken by the app yet, so the limits above (the estimate plus the larger of £5 or a
fifth, never over the whole-order cap, a person for anything else) are what protect against a wrong figure.
