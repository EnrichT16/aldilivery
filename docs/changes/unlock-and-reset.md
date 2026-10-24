# Unlocking anybody, and resetting a PIN or a password

Decided by Anthony on 24 October 2026, recorded as ruling 81 in docs/BUILD_PROMPT.md. It builds on the Shopper's four-digit PIN (Section D), the owner and staff accounts and their two-step codes (ruling 55 and Section Q), the message and call codes and the permission to authorise them (ruling 77), and the permission to send jobs straight to a Runner (ruling 80), whose pattern it follows.

## Why

Every lock in the service is there to keep someone safe: three wrong PINs lock a Shopper's PIN for fifteen minutes, five wrong passwords or codes lock a staff member out of signing in for fifteen minutes, five wrong message or call codes lock a staff member out of codes for fifteen minutes, and the number of sign-in codes a phone can be sent is limited, so nobody can run up the bill by having thousands of texts sent. But a Shopper who has forgotten their PIN, or a member of staff who mistyped in a hurry, should not have to wait, or ring and be told nothing can be done. Somebody trusted should be able to let them back in, at any time, and the person should be told that it happened.

## Who may do it

The owner, and the staff he chooses. A staff member may unlock people only when the owner has switched it on for them in Team, with the button "Let them unlock people". Only the owner can switch it on or off, in the same way as letting someone authorise messages and calls, or send jobs to Runners. The owner always may. The staff key, which is the founder without an account of his own, may too. Family and investor accounts only look, so they never may. Without the permission, every one of these tools refuses.

## What they can do

- **Unlock a Shopper's PIN.** The wrong tries go back to none and the lock is lifted, so the Shopper can try their PIN again straight away. The PIN itself is not changed.
- **Reset a Shopper's PIN.** The PIN is removed and any lock lifted, so the Shopper is asked to choose a new PIN the next time one is needed, exactly as the first time. The person doing it is asked to confirm first, because the Shopper will have to choose a new one.
- **Unlock a staff member.** This lifts both locks at once: signing in to the admin panel after wrong passwords, passcodes or two-step codes, and message and call codes after five wrong codes.
- **Give a staff member a new password.** A temporary password is made and shown once to the person who reset it, to pass on. The staff member must choose their own the next time they sign in. Asked to confirm first. The owner's own account can only be reset by the owner himself, never by any other member of staff and never with the staff key.
- **Clear the limits on sign-in codes for an account's phone.** The account is found by name, and the codes already sent to its number stop counting towards the limits, so the person can ask for a new code at once. Staff never see the whole telephone number, only its last three digits, as "ending 123".

## Where they are

- **Needs you now** has a "Locked out" list, for everyone who may unlock: every Shopper whose PIN is locked, every staff member locked out of signing in or of codes, and every account whose phone has reached the limits on sign-in codes, each in plain words with when it would open by itself, and an Unlock button. A staff member who may unlock sees Needs you now for this list even if their job does not otherwise include it.
- Under the list, **Find someone to unlock or reset** finds Shoppers, Runners and staff by name, username or the last numbers of their phone, with what each is locked out of and the buttons that fit them.
- **Shopper accounts**, the owner's own tab, has "Unlock PIN", "Reset PIN" and "Clear sign-in code limits" on each Shopper's account.
- **Team** shows when someone is locked out now, with an Unlock button, and "New password" for those who may unlock.

Every button says what it does in words, with the person's name for a screen reader.

## Written down, and told

Each one is written in the audit log: who did it, to whom, what, and when. No PIN, password or code is ever written there, logged or shown, except the temporary staff password, which is shown once to the person who made it and nowhere else.

The person affected is told by text, in plain words, with no secret in it. A Shopper whose PIN was reset is sent: "Your PIN was reset by Ozi Delivery. You will be asked to choose a new one the next time it is needed. If you did not ask for this, ring" and the business's telephone number. The name and the number come from config/store.json (Rule Nine). Unlocking a PIN and clearing the sign-in code limits send words of the same kind. Staff accounts have no telephone number, so the screen says so and asks whoever did it to let the person know.

## Shoppers changing their own PIN

A Shopper who knows their PIN can now change it, under "Your PIN" on the Your addresses page, also reached from Settings with "Change your PIN". They type their current PIN, then the new one twice. The new PIN follows the same rules as the first (four numbers, not the same number four times, not a run, not a year), and must differ from the current one. Wrong current PINs count towards the lock, three and it waits fifteen minutes, as anywhere else. The fields are emptied after every try, and the Shopper is sent a text saying their PIN was changed, with no PIN in it.

A Shopper who has forgotten their PIN still needs someone to reset it for them. A way for a Shopper to reset a forgotten PIN themselves is not part of this change; it waits for Anthony's approval.

## By voice

In the admin panel, Ozi understands "unlock Yvette" and "reset Yvette's PIN". It reads back what it is about to do, does it only after a yes, and says the result aloud. If more than one Shopper has that name, it says so and opens Needs you now to choose the right one on the screen. For the Shopper, "change my PIN" opens the change form on Your addresses. The PINs are typed there, never said to Ozi.

## Tests

`packages/api/test/unlock-and-reset.test.ts` and `packages/web/test/unlock.test.tsx`, with the change form in `packages/web/test/addresses.test.tsx`.
