# Sending jobs straight to a chosen Runner

Decided by Anthony on 24 October 2026, recorded as ruling 80 in docs/BUILD_PROMPT.md. It builds on dispatch and the fair queue (rulings 59 to 64), carrying limits and split jobs (rulings 60 and 61), the order rescue tools, Ozi's desk (ruling 74), the staff permissions and Team (ruling 77) and orders booked for a later day (ruling 78).

## Why

The fair queue decides who is offered each job, and that is right for most of the day. But the office sometimes knows better: a Runner is already near a cluster of orders, a regular customer asked for someone they trust, or a busy evening needs jobs handed out by a person. Until now the only tool was "Give it to another Runner", one order at a time, meant for an order that had got stuck.

## Who may do it

The founder, and the staff he chooses. A staff member may send jobs straight to Runners only when the owner has switched it on for them in Team, with the button "Let them send jobs to Runners". Only the owner can switch it on or off, in the same way as letting someone authorise messages and calls. The owner always may. The staff key, which is the founder without an account of his own, may too. Family and investor accounts only look, so they never may.

Anyone with the Orders tab can still use "Give it to another Runner" exactly as before. Without the new permission, the new tools simply refuse.

## No limits

The office may send any number of orders to any number of Runners in one go, and several orders to the same Runner. Each one is dealt with on its own, in the order given, and answered on its own. One that cannot go never stops the rest.

An order is refused, with the reason in plain words, when:

- it has been bought already, is being shopped already, or has been delivered or cancelled;
- it has not been paid for yet;
- the Runner cannot carry it, because of the carrying limit for their way of travelling, with the reason given;
- the Runner is not approved to take jobs;
- it has been split into parts (each part can be sent on its own, to a Runner of its kind);
- it is a demo order;
- it is booked for a later day, unless the office chose to send it early on purpose.

An order booked for later today is sent, and held for the Runner until its usual offer time, unless the office chose to send it early.

If a Runner had already said yes to the order, they are released and told by text to stop and buy nothing, exactly as when an order is given to another Runner, and the Shopper is told their order is being passed to another Runner.

## A Runner with more than one job

A Runner carries one job at a time. So when the office sends a Runner several jobs, they wait in that Runner's own queue, in the order they were sent. The first is offered straight away. The next is offered automatically as soon as the one in hand is delivered, or if the Runner says no to the one offered. While jobs wait for a Runner, the ordinary queue does not offer those orders to anybody else, and does not offer that Runner other work.

## How the Runner gets it

Runners are self-employed, so a job from the office is still theirs to take or to turn down. It reaches them at once, as a priority offer held for them alone for ten minutes rather than the usual minute. The ten minutes is `allocation.allocatedHoldMinutes` in config/store.json.

They are told three ways:

- by a notification on their phone, if they have allowed it on their Runner page ("Tell me when the office sends me a job");
- by a text, "The office has sent you job …", with how many things, about how much shopping, what they will be paid and the ten minutes, and never the customer's name, address or telephone number;
- by Ozi, who says it out loud on the Runner page. It shows even when they are off shift.

The pay is exactly what it would have been. Nothing about a job from the office changes Rule Two.

## When the Runner says no, or does not answer

If the Runner says no, or the ten minutes run out, the order goes to the backup Runner the office chose, if they chose one and that Runner can still have it. Otherwise it goes back to the ordinary queue for any Runner.

The person who sent it is told on the Allocate jobs page, and on their own device if they have allowed notifications. It also goes on Ozi's desk, as something to hear, only when it has come back.

## The record

Every job sent is written in the audit log: who sent it, which order, which Runner, and when. It is also on the order's own history in the Orders tab, with what became of it: offered, taken, said no to, run out, gone to the backup, or back in the queue.

## The Allocate jobs page

In the admin panel's Orders tab, those who may send jobs have a second view, "Allocate jobs", beside "Find orders". It shows:

- the orders waiting or offered, oldest first and numbered: paid orders, orders offered to a Runner, orders a Runner has taken but not yet started shopping, and orders booked for today. Each has a checkbox and its own "Send order … to" picker. "Select all" chooses them all at once;
- the approved Runners, on shift first, each with how many jobs they hold and how they travel, to choose one;
- a backup Runner, if wanted, and "Send booked orders now, before their time";
- the button "Send to Runner";
- the results, read back in one sentence, such as "4 orders sent to Tomasz; 1 could not be: order 7KQ2PX, it has been bought already.";
- "Sent lately", with what became of each.

Choose orders, choose a Runner, press "Send to Runner", and repeat for other Runners. Every control is an ordinary form control with its words beside it, so the page works by keyboard and with a screen reader.

By voice, Ozi in the admin panel understands "send order 1 2 3 4 to Tomasz" and "send all waiting orders to Ayesha". The numbers are those on the page. Ozi reads it back, sends only after a yes, and then says the results, including any that could not go and why.

## Where it lives

- The rules and the queue for each Runner: `packages/api/src/services/allocate.ts`.
- The page's data and sending: `packages/api/src/routes/allocate.ts` (`GET /staff/allocate`, `POST /staff/orders/allocate`).
- The permission: `POST /staff/team/:id/allocate` in `packages/api/src/routes/staff.ts`.
- A Runner's notifications: `POST /runners/me/push-subscriptions` in `packages/api/src/routes/push.ts`.
- The database: migration `20261102090000_allocate_jobs`, which adds the permission, the `JobAllocation` table, a mark on an offer that it came from the office, and a Runner on a notification device.
- The page: `packages/web/src/components/AllocateJobs.tsx`; the voice commands in `packages/web/src/voice/staff-voice.ts` and `packages/web/src/components/StaffVoice.tsx`; the Runner's side in `packages/web/src/pages/RunnerHome.tsx`.
- Tests: `packages/api/test/allocate-jobs.test.ts`, `packages/web/test/allocate-jobs.test.tsx` and `packages/web/test/runner-home.test.tsx`.
