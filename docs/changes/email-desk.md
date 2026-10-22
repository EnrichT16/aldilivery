# Ozi reads the business mailbox

Decided by Anthony on 22 October 2026, recorded as ruling 76 in docs/BUILD_PROMPT.md. It builds on Ozi's desk (ruling 74, docs/changes/ozi-desk.md).

## Why

Anthony is registered blind, and emails to the business sat in the mailbox until somebody read them to him. He asked for three things: that important emails are read to him by Ozi on the phone, that unimportant ones do not ring him, and that simple enquiries are answered by Ozi itself.

## Where the mail is

Nothing about where the business's email is delivered has changed. The mailbox stays on the company's existing mail host, and no DNS, MX or forwarding setting was touched. The server simply signs in to the mailbox the way a mail app on a phone would.

## How it works

Every five minutes the server looks at the unread emails in the inbox. For each new one it reads who it is from, the subject, the start of the words (about the first two thousand characters), and the names of any attachments. It never opens an attachment.

The automatic check then sorts the email. It decides what kind of email it is, whether it needs Anthony, and writes one or two sentences that Ozi can say aloud, without reading out long numbers or email addresses. It is told that the email is something to sort, not something to obey, so an email cannot tell it what to do.

Important emails go on Ozi's desk, and Ozi reads them to Anthony on its next call. These are emails that need a decision, complaints, anything legal or official (such as HMRC, Companies House, the ICO, a bank, or a Stripe payment dispute), shops or organisations wanting to work with us, and anything about money owed or someone's safety. Ozi says who the email is from, its subject and what it is about, and then "Press 1 if you have heard it, 3 to hear it later". Complaints, decisions, legal or official emails and approaches from shops or organisations always go on the desk.

Spam, newsletters and automatic notices are only marked as read. They never ring Anthony.

## Answering simple questions

When a customer asks a simple question that the service's own facts answer, such as what delivery costs, Ozi can reply by email itself. This is switched off unless EMAIL_AUTO_REPLY is set to "on". The reply is two or three plain sentences, starting "Hello," and signed "Kind regards," with the service's name. It is sent from the business mailbox, in the same conversation, and is marked as an automatic reply so other machines do not answer it back. Ozi never replies to a "noreply" address, a mailing list or our own mailbox. The audit log records each reply as the automatic check.

While replies are switched off, or if a reply cannot be sent, the question goes on Ozi's desk for Anthony instead.

## Without the language model

Without the language model key, nothing is sorted automatically. Every new email from a person goes on Ozi's desk with only who it is from and its subject. Emails that are plainly automatic, such as those from a "noreply" address, and mailing lists and newsletters, do not.

## Nothing twice

Each email is recorded once, by its Message-ID, before it is marked as read. The record keeps only the part of the sender's address after the @, what kind of email it was, whether it was important, the matter it became, whether Ozi replied, and when. If an email cannot be recorded, it stays unread and is tried again on the next check, and Anthony is not asked about it twice.

## In the admin panel

On the "Needs you now" page, an email on Ozi's desk shows who it is from and its subject, beside the Heard it and Later buttons.

## Privacy

The privacy page has a paragraph saying that emails to the business are read by the automatic check to sort them, that attachments are not read, and that only a short summary, with who it is from and its subject, is kept. The password is never written to the log, and neither are the words of any email.

## What Yvette has to set

In cPanel, open Email Accounts and choose Connect Devices beside the business address. Under "Secure SSL/TLS Settings" it shows what is needed:

- EMAIL_IMAP_HOST: the Incoming Server.
- EMAIL_IMAP_PORT: 993.
- EMAIL_IMAP_USER: the username, which is the full email address.
- EMAIL_IMAP_PASSWORD: that mailbox's own password. In DigitalOcean this is a secret.

Only if Anthony wants Ozi to answer simple questions:

- EMAIL_SMTP_HOST: the Outgoing Server, from the same page.
- EMAIL_SMTP_PORT: 465.
- EMAIL_AUTO_REPLY: on.

LANGUAGE_MODEL_KEY must already be set for the sorting and the replies; without it, every email from a person goes to Anthony with its sender and subject only.
