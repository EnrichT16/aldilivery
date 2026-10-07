# Keeping the service safe: the security proposal

Written for Anthony, 7 October 2026 (ruling 44), in plain words. Each technical word is
explained the first time it appears. Where a step is **done**, it is already in the code.
Where it says **to do**, it is a job still waiting, with who does it.

---

## 1. The big idea, like a school

Think of the service as a school.

- **The front gate** is the website and the app. Anyone can walk up to it.
- **The classrooms** are the different accounts: Shoppers, Runners, Shop Partners,
  organisations, staff, family, investors and the owner. Each has its own key, and a key
  opens **one** classroom only.
- **The head teacher's office** is the owner's account. Only it sees the money.
- **The safe** is the database, where everything is written down. Nobody walks into the safe.
  They ask the office (the server) and the office decides what they may see.
- **The bank vault next door** is Stripe. Card numbers go straight there and never come into
  our school at all.

Good security is not one big wall. It is **many small doors, each locked**, so that getting
through one door does not get you through the rest. Experts call this **defence in depth**.

---

## 2. If someone steals one account, what can they take?

The rule is called **least privilege**: every account can only do the smallest set of things
its job needs. So a stolen key opens one small room.

| Account stolen                  | What the thief **can** see or do                                                                 | What the thief **cannot** do                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A Shopper**                   | That one Shopper's orders, saved addresses, basket. Place an order to an address already saved.   | See the card number (Stripe holds it). Send shopping to a new address without the PIN. See any other Shopper. See any Runner's phone number.        |
| **A Runner**                    | That Runner's jobs and pay history, the shopping list and drop-off for the current job only.      | See Shoppers' phone numbers (never shown). See past customers' addresses. Change their pay. See other Runners.                                       |
| **A Shop Partner**              | That shop's products, prices and payments.                                                        | See who bought (no names). Publish a product without a person checking it. See other shops.                                                          |
| **An organisation**             | The people who chose to link to it, their orders and spending.                                    | See anyone who did not link. See card details. See other organisations.                                                                             |
| **A staff member**              | Only their job's tabs (for example, complaints for customer care).                                 | See the money (owner only). Open tabs outside their job. Make another staff account (founder only).                                                 |
| **Family or an investor**       | Only the parts the owner switched on, read only.                                                   | Change anything. See the money. Ever.                                                                                                              |
| **The owner's account**         | Everything, including the money.                                                                   | Take card numbers (Stripe has them). Without the passcode and the two-step code, the password alone does not open it.                              |
| **The server itself (worst case)** | The database: names, phone numbers, addresses, orders.                                         | Card numbers (never stored). Passwords, PINs and passcodes (stored only as scrambled "hashes", which cannot be turned back into the password).      |

**A hash** is like putting a password through a blender. You can check a password by blending
it again and comparing, but you can never un-blend the smoothie back into the password.

---

## 3. Can we build a "one-way light"? (a data diode)

Anthony's idea: if a thief gets in, they cannot send anything back out.

**Yes, the idea is real.** In power stations and the military it is called a **data diode**:
a cable that physically only carries light one way, like a one-way street. Data can go in,
nothing can come out.

For a shopping app the whole server cannot be a diode, because it must answer Shoppers. But
we can use the same idea for the parts that matter most:

1. **One-way logs ("write-only records").** Every important action (a sign-in, a refund, a
   kill switch) is copied to a separate record store that the server can **add to but never
   read, change or delete**. A thief inside cannot cover their tracks. **To do**, Claude Code:
   send the audit log to a separate, append-only store (for example DigitalOcean Spaces or
   Backblaze with "object lock").
2. **Locked backups ("immutable backups").** Database copies are kept where even our own
   server cannot delete them for 30 days (**object lock**). If someone breaks in and wipes or
   scrambles everything (**ransomware**), we restore yesterday's copy. **To do**, Anthony
   with Claude Code: switch on daily backups and point-in-time recovery on the DigitalOcean
   database (LAUNCH.md already lists this), plus a weekly locked copy elsewhere.
3. **"Only talk to friends" (egress allowlist).** The server is only allowed to send data out
   to a short list of addresses it needs: Stripe, Twilio, LiveKit, and the database. If a
   thief tries to post our data to their own computer, the door is shut. **Egress** means
   "going out". **To do**: DigitalOcean App Platform does not offer this yet; when we move
   to our own servers (the growth plan, stage 3) this is switched on with a firewall.
4. **Card numbers never come in at all**, so they can never go out. **Done** (Stripe).

---

## 4. The full plan, layer by layer

### Layer 1: The front gate (the internet edge)

| Step | What it means | Status |
| ---- | ------------- | ------ |
| HTTPS everywhere | The padlock in the browser: everything sent is scrambled so nobody on the Wi-Fi can read it. | **Done** (DigitalOcean) |
| Strict HTTPS header (HSTS) | Tells browsers "only ever talk to us with the padlock", for a year. | **Done** (ruling 44) |
| Safety headers | Tell browsers not to show our pages inside someone else's site (stops trick clicks), and not to guess file types. | **Done** (ruling 44) |
| Sign-in speed limit | One internet address can only try to sign in 30 times in 10 minutes. Stops someone guessing thousands of passwords. | **Done** (ruling 44) |
| Account lock | Five wrong passwords and that account waits 15 minutes. | **Done** |
| A shield in front (Cloudflare) | A service that sits in front of the website and blocks floods of fake visitors (a **DDoS**, "too many visitors at once on purpose") and known attacks (a **WAF**, web application firewall). Free plan is enough to start. | **To do**: Anthony creates a free Cloudflare account, Claude Code moves the domain's settings. |

### Layer 2: The keys (accounts and sign-in)

| Step | What it means | Status |
| ---- | ------------- | ------ |
| Separate key for each kind of account | A Shopper key cannot open the staff panel, and so on. Tested. | **Done** |
| Owner passcode + two-step codes | The owner needs a password, a 7-character passcode, and can add a 6-number code from an authenticator app that changes every 30 seconds (**2FA**, two-factor). | **Done** (switch on two-step in My settings) |
| Kill switch | One press with the passcode signs every admin out and switches off family and investor access. | **Done** |
| Staff choose their own password | And it is stored as a hash. | **Done** |
| Two-step codes for all staff | Same as the owner's, for every admin. | **To do**, Claude Code (small) |
| Fingerprint / face for the owner | In the phone apps. | **To do**, with the phone apps |

### Layer 3: The safe (the data)

| Step | What it means | Status |
| ---- | ------------- | ------ |
| No card numbers | Stripe holds them. | **Done** |
| Phone numbers never shown between Shoppers and Runners | Calls go through the app. | **Done** |
| Analytics with no names | People become one-way codes, places become postcode districts, groups under 10 hidden. | **Done** |
| Ozi's phrases hidden | Kept on the server, never sent to the app. | **Done** (ruling 44) |
| Database encrypted at rest | The disk itself is scrambled, so a stolen disk is useless. | **Done** (DigitalOcean managed databases do this) |
| Daily backups + point-in-time recovery | Go back to any minute in the last 7 days. | **To do**, Anthony switches on in DigitalOcean (LAUNCH.md) |
| Locked off-site copy | See section 3. | **To do** |

### Layer 4: Secrets (the master keys)

**Secrets** are the passwords our server uses to talk to Stripe, Twilio and so on.

- They live only in DigitalOcean's settings, marked "encrypted", never in the code and never
  in chat. **Done.**
- **Rotate** them (change them) every 6 months, and at once if anyone who knew one leaves.
  **To do**, Anthony, with a reminder.
- Stripe "restricted keys": a Stripe key that can only charge and refund, not pay money out.
  **To do**, Anthony when going live.

### Layer 5: The building materials (code and its parts)

- Every change is tested automatically before it can go live (433 server tests, 269 app
  tests today). **Done.**
- **Dependency scanning**: our code uses parts written by others (**dependencies**). A robot
  (GitHub Dependabot) checks them every week for known weaknesses and suggests updates.
  **To do**, Claude Code switches it on (free).
- **Secret scanning**: GitHub checks that no password is ever saved in the code by mistake.
  **To do**, switch on in GitHub settings (free).

### Layer 6: Watching (continuous monitoring)

"Continuous" means someone, or something, is always watching.

- **Uptime check**: a free service visits the site every minute and texts Anthony if it is
  down. **To do** (UptimeRobot or Better Stack, free).
- **Alerts**: a message to the owner when something unusual happens: many failed sign-ins,
  the kill switch used, a new staff account made, a large refund. **To do**, Claude Code.
- **Audit log**: a record of who did what and when in the admin panel. Decisions are already
  recorded with who made them; a full log is **to do**.

### Layer 7: People

Most break-ins start with a trick message, not clever hacking (**phishing**: a fake email or
text pretending to be us, Stripe or the bank, asking for a password or a code).

- Rule for everyone: **we never ask for a password, passcode or code by phone, text or
  email.** Ozi says this too.
- A one-page guide for every new staff member. **To do**, Claude Code drafts it.
- Each person has their own account, so nobody shares passwords. **Done.**

### Layer 8: Testing ourselves

- **A penetration test** ("pen test"): paying a trusted expert to try to break in and tell us
  how, before a real criminal does. **Recommended** before taking large numbers of Shoppers
  (around 10,000), roughly £2,000 to £5,000 for a small company.
- **Cyber Essentials**: a UK government-backed certificate that shows we have the basics
  right. Councils and the NHS often ask for it before working with a supplier. About £320.
  **Recommended** before signing organisations.

---

## 5. If the worst happens: getting back up (recovery)

A written plan, so nobody has to think in a panic. This is called an **incident response
plan**.

1. **Stop it spreading.** The owner presses the kill switch (all admin sessions out). Claude
   Code changes the server's secret key, which signs **every** Shopper and Runner out too.
2. **Change the master keys.** Stripe, Twilio, LiveKit and the staff key are replaced.
3. **Find out what happened** from the one-way logs (which the thief could not change).
4. **Restore** the database from the last clean backup if anything was changed or deleted.
5. **Tell people, within 72 hours.** UK law (the UK GDPR) says that if personal data may have
   been taken, we tell the ICO (we already have an ICO registration) within 72 hours, and
   tell the people affected if it could harm them.
6. **Fix the hole**, test it, and write down what we learned.

**Practise it** once a year, like a fire drill.

---

## 6. In one sentence each, the most important next steps

1. Switch on database backups and point-in-time recovery (Anthony, 10 minutes).
2. Switch on two-step codes on the owner account (Anthony, 5 minutes).
3. Put Cloudflare in front of the website (Anthony and Claude Code, an hour).
4. Switch on GitHub Dependabot and secret scanning (Claude Code, minutes).
5. Uptime check with a text alert (Anthony, 10 minutes).
6. Send the audit log to a one-way store, and keep a locked weekly backup (Claude Code).
7. Cyber Essentials before signing councils or the NHS; a pen test before 10,000 Shoppers.
