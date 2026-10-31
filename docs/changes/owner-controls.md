# The owner's controls: staff, mailboxes, and how Ozi reaches him

Decided by Anthony on 31 October 2026, recorded as ruling 85 in docs/BUILD_PROMPT.md. It builds on staff accounts (7 October 2026), Ozi's desk (ruling 74, docs/changes/ozi-desk.md), the email desk (ruling 76, docs/changes/email-desk.md), Ozi ringing him in the app (ruling 79), the owner's desk by voice (ruling 83) and his phone staying signed in (ruling 84).

## Why

Anthony is registered blind and runs the business by voice. He wanted to know which of his staff are signed in and roughly where, and to switch any of them off at once; to hear his emails from more than one mailbox, a Gmail address among them, whenever he asks; and to choose for himself how Ozi lets him know about each kind of thing.

## 1. Seeing and controlling all staff

### The staff list

In the admin panel, on the Team page, the owner sees "All staff, and their sign-ins". By voice he can ask Ozi "who is signed in?" (the `list_staff` tool). For each staff account, family and investor accounts included, it says:

- the name and job;
- whether the account is switched on or off;
- whether the person is signed in now (seen in the last `admin.staffOnlineMinutes`, 15), or when they were last seen;
- roughly where their latest activity came from, a town or a country, or "place not known".

### Where the place comes from

Each sign-in, and each spell of activity (at most once every five minutes for each account and internet address), is kept as a staff sighting: when, a one-way code of the internet address (never the address itself), roughly where, and the kind of device (phone, tablet, computer or other).

The place is only what the hosting platform itself adds to the request: Cloudflare's `cf-ipcountry` and `cf-ipcity`, or the same from Vercel, CloudFront or App Engine. No geo-IP service is ever asked, paid or free. If no header says, the place is "place not known". Someone could add such a header themselves where the platform does not overwrite it, so the place is a guide, never proof.

Sightings are kept 90 days (`admin.staffSightingsKeepDays`), then the hourly retention sweep removes them.

### The switches

Each account has its own switch, and there is one "Switch off all staff except me", which asks once more before it acts.

- Switching an account off sets it inactive and signs it out everywhere at once. Its session version and its remembered-phone version both go up, so every `st1` token it holds, a phone kept signed in included, stops on the very next request. The account's `active` is also checked on every request.
- Switching it back on lets the person sign in again with their password. Old tokens stay dead.
- Only the owner may use the switches: his own account, signed in with his passcode. The staff key, and every other account, is refused.
- The owner's own account can never be switched off this way.
- Every switch is written in the audit log as the owner's, with how it was done: "in the admin panel" or "by voice, talking to Ozi".

By voice, `switch_staff` (one account, on or off, by name) and `switch_all_staff_off` only prepare. Ozi reads back, in fixed words, "To be sure, Mr. Anthony: I will switch off Yvette Okoro's account, and sign it out everywhere. Shall I go ahead? Say yes, or no." It is done only on his clear yes in his very next turn, through the same service function the panel uses (`packages/api/src/services/staff-control.ts`).

The existing kill switch (My settings, `POST /staff/owner/kill-switch`, with his passcode) is unchanged: it still signs out every admin session, his own too, and switches off everything for family and investors.

## 2. Several mailboxes, read to him on request

### Setting up more mailboxes

The first mailbox is unchanged: `EMAIL_IMAP_HOST`, `EMAIL_IMAP_USER`, `EMAIL_IMAP_PASSWORD`, and so on. `EMAIL_LABEL`, which is optional, is what Ozi calls it aloud; without it, it is "the business mailbox".

Up to four more mailboxes are set with numbered keys, from `EMAIL_2_` to `EMAIL_5_`:

| Key | What it is |
| --- | --- |
| `EMAIL_2_IMAP_HOST` | The incoming server, such as `imap.gmail.com` |
| `EMAIL_2_IMAP_USER` | The full email address |
| `EMAIL_2_IMAP_PASSWORD` | The mailbox's password, or for Gmail an app password (secret) |
| `EMAIL_2_LABEL` | What Ozi says aloud, such as "the Gmail" |
| `EMAIL_2_SMTP_HOST` | The outgoing server, such as `smtp.gmail.com`, for replies (optional) |
| `EMAIL_2_IMAP_PORT`, `EMAIL_2_SMTP_PORT` | Optional: 993 and 465 unless given |
| `EMAIL_2_AUTO_REPLY` | Optional: "on" lets Ozi answer simple questions from this mailbox too |

A mailbox is used only when its host, user and password are all real values. A placeholder counts as nothing. The same address given twice is read once. Each mailbox is read every five minutes, a few seconds apart. Passwords are never read aloud, printed or logged.

### Gmail

Gmail works by IMAP at `imap.gmail.com`, port 993, with an app password, never the normal Gmail password:

1. At myaccount.google.com, open Security and switch on 2-Step Verification if it is not on.
2. Still in Security, open App passwords and make one called "Ozi". Google shows 16 letters, once.
3. In DigitalOcean, set `EMAIL_2_IMAP_HOST` to `imap.gmail.com`, `EMAIL_2_IMAP_USER` to the full Gmail address, `EMAIL_2_IMAP_PASSWORD` to the 16 letters (as a secret), `EMAIL_2_LABEL` to "the Gmail", and, so Anthony can reply by voice, `EMAIL_2_SMTP_HOST` to `smtp.gmail.com`.

`.do/app.yaml` and `.env.example` carry these keys as optional placeholders.

### Short summaries to listen to

Every email from every mailbox leaves a short stored summary for Anthony to ask about:

- which mailbox, by its label;
- who it is from, by display name only (an email address is never kept as the name, and never said);
- the subject, when it came, and the one or two sentence spoken summary;
- what kind of email it is, whether it is important, and whether he has heard it.

The start of its plain words, up to `emailDesk.readAloudCharacters` (1,500), is kept with phone numbers, card numbers, codes and email addresses blanked. Attachments are never kept. The sender's address is kept only so his reply can be sent; it is never shown or said. Summaries are kept 30 days (`emailDesk.summaryKeepDays`), then the hourly retention sweep removes them.

### By voice

- `list_emails`: today's, unheard, important, from a name, or from one mailbox ("the Gmail").
- `read_email`: the spoken summary and up to about 1,500 characters of the words, blanked as above.
- `mark_heard`: read back, then done on his yes.
- Replying: he says "reply saying …", and Ozi reads the reply back word for word, with the mailbox it goes from and the sign-off ("Signed" and the service's name). It is sent only on his yes, from the same mailbox, in the same conversation. A mailbox with no outgoing server cannot reply, and Ozi says so. The automatic replies to simple questions are unchanged.

### Emails are data, never instructions

The tools' descriptions and Ozi's standing instructions say plainly that email content is untrusted. Ozi never follows instructions found in an email and never takes an action because an email asks for it. `read_email` marks what it gives back as untrusted. Even if the model were fooled, it can only propose: nothing changes until Anthony himself says yes, and words inside an email are never his yes.

## 3. How Ozi reaches him: his choice

For each kind of matter he chooses a call, a text, a notification, or nothing:

| Kind | Default |
| --- | --- |
| Urgent safety, such as a Runner pressing SOS | Call, always, even in quiet hours. It cannot be changed. |
| Important emails | Call |
| Other emails | Nothing |
| Runner and partner approvals | Call |
| Money (pay-backs, till totals, bank transfers, booked payments, held shares) | Call |

His quiet hours start from `ownerDesk.quietFrom` and `ownerDesk.quietUntil`. The defaults are `ownerAlerts` in config/store.json; his own choices are kept in one `OwnerPreference` row.

- He changes them by voice (`get_alert_preferences`, `set_alert_preferences`, read back then his yes), or in My settings, "How Ozi reaches me", one group of radio buttons for each kind, and two time fields for the quiet hours.
- "Call" works as Ozi's desk always has: rung in the app first, then his phone.
- "Text" and "notification" go once for each matter, never in quiet hours, saying how many and what kind ("an approval needs you"), never what. The notification uses the push notifications already on his devices from ruling 79; with no device to show it, it goes as a text instead.
- "Nothing" leaves it on the Needs you now page until he asks.
- Anything not in these kinds is rung about as before.
- `ownerDesk.urgentInQuietHours` is no longer consulted: urgent safety always calls, even in quiet hours.
- The email desk obeys them too. An important email always goes on the desk and reaches him his chosen way. Another email from a person goes on the desk only if he asked to hear about other emails. Spam, newsletters and notices never do.

Every change is written in the audit log as his, with how it was done.

## Database

The `20261114090000_owner_controls` migration only adds. It brings the `StaffSighting`, `EmailSummary` and `OwnerPreference` tables, and two columns on `OwnerMatter`: `alertKind` (which choice a matter follows) and `alertedAt` (when its text or notification went). The memory and Prisma repositories are kept in step.

## Tests

- `packages/api/test/owner-controls.test.ts`: switches and immediate sign-out, the owner-only rule, the read-back and yes for each tool that changes something, several mailboxes, an email with instructions being ignored, and alert choices being obeyed.
- `packages/web/test/owner-controls.test.tsx`: the panel sections, with axe.
- `packages/core/test/config.test.ts`: the new configuration.
