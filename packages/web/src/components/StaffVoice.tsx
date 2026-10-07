import { useEffect, useRef } from 'react';

import {
  decideFind,
  decideProblem,
  decideStaffPartnerProduct,
  fetchStaffPartnerProducts,
  fetchStaffDocuments,
  fetchStaffEnquiries,
  fetchStaffFeedback,
  fetchStaffFinds,
  fetchStaffProblems,
  fetchStaffRecoveries,
  fetchTeam,
  markEnquiryHandled,
  reviewDocument,
  writeOffRunner,
  type StaffArea,
  type StaffDocument,
  type StaffEnquiry,
  type StaffFindRequest,
  type StaffPartnerProduct,
  type StaffProblem,
  type StaffRecovery,
} from '../lib/api';
import { money } from '../lib/money';
import { useOzi } from '../state/ozi';
import { nameHeardIn } from '../voice/name';
import {
  AREA_WORDS,
  help,
  readItem,
  spokenMoney,
  summary,
  understand,
  waiting,
  type StaffLists,
} from '../voice/staff-voice';

const YES = /\b(yes|yeah|yep|correct|that'?s right|go ahead|confirm|do it|ok|okay)\b/i;

const DECISION_WORDS = {
  no_fault: 'nobody was at fault',
  runner_at_fault: 'the Runner was responsible',
  shop_at_fault: 'the shop was responsible',
  platform_at_fault: 'we were responsible',
  shopper_at_fault: 'the Shopper was responsible, so no refund',
} as const;

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** "31st of March 2027" or "31/3/2027" as 2027-03-31; null when it is not a date. */
export function spokenDate(said: string): string | null {
  const text = said.toLowerCase();
  const numeric = text.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  let day: number | undefined;
  let month: number | undefined;
  let year: number | undefined;
  if (numeric) {
    day = Number(numeric[1]);
    month = Number(numeric[2]);
    year = Number(numeric[3]);
  } else {
    const index = MONTHS.findIndex((name) => text.includes(name));
    const dayMatch = text.match(/\b(\d{1,2})(st|nd|rd|th)?\b/);
    const yearMatch = text.match(/\b(20\d{2})\b/);
    if (index >= 0 && dayMatch && yearMatch) {
      day = Number(dayMatch[1]);
      month = index + 1;
      year = Number(yearMatch[1]);
    }
  }
  if (!day || !month || !year || month > 12 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Ozi in the admin panel (7 October 2026): says what is waiting when someone signs in, reads
 * every list aloud, moves between the tabs, and makes decisions by voice, each read back and
 * done only after a yes. So the whole panel can be used without touching or seeing it.
 */
export function StaffVoice({
  staffKey,
  by,
  name,
  title,
  areas,
  onOpen,
  onChanged,
  onSignOut,
}: {
  staffKey: string;
  by: string;
  name: string;
  title: string;
  areas: readonly StaffArea[];
  /** Show this tab on the screen too. */
  onOpen: (area: StaffArea) => void;
  /** Something was decided: the screen loads its lists again. */
  onChanged: (news: string) => void;
  onSignOut: () => void;
}): null {
  const ozi = useOzi();
  const lists = useRef<StaffLists>({});
  const cursor = useRef<{ area: StaffArea; index: number } | null>(null);
  const latest = useRef({ ozi, staffKey, by, name, title, areas, onOpen, onChanged, onSignOut });
  latest.current = { ozi, staffKey, by, name, title, areas, onOpen, onChanged, onSignOut };

  useEffect(() => {
    const { ozi: voice } = latest.current;
    let cancelled = false;

    async function load(): Promise<void> {
      const { staffKey: key, areas: mine } = latest.current;
      const next: StaffLists = {};
      const loaders: Array<Promise<void>> = [];
      const add = <T,>(
        area: StaffArea,
        load: () => Promise<T>,
        pick: (result: T) => unknown[],
      ): void => {
        if (!mine.includes(area)) return;
        loaders.push(
          load()
            .then((result) => {
              (next as Record<string, unknown>)[area] = pick(result);
            })
            .catch(() => undefined),
        );
      };
      add(
        'documents',
        () => fetchStaffDocuments(key),
        (r) => r.documents,
      );
      add(
        'problems',
        () => fetchStaffProblems(key),
        (r) => r.reports,
      );
      add(
        'feedback',
        () => fetchStaffFeedback(key),
        (r) => r.feedback,
      );
      add(
        'owed',
        () => fetchStaffRecoveries(key),
        (r) => r.recoveries,
      );
      add(
        'finds',
        () => fetchStaffFinds(key),
        (r) => r.requests,
      );
      add(
        'enquiries',
        () => fetchStaffEnquiries(key),
        (r) => r.enquiries,
      );
      add(
        'partners',
        () => fetchStaffPartnerProducts(key),
        (r) => r.products,
      );
      add(
        'team',
        () => fetchTeam(key),
        (r) => r.team,
      );
      await Promise.all(loaders);
      lists.current = next;
    }

    function say(text: string): void {
      void latest.current.ozi.say(text);
    }

    function current(): unknown {
      const at = cursor.current;
      return at ? waiting(lists.current, at.area)[at.index] : undefined;
    }

    function readAt(area: StaffArea, index: number): void {
      const items = waiting(lists.current, area);
      if (items.length === 0) {
        cursor.current = { area, index: 0 };
        say(`There are no ${AREA_WORDS[area].many} right now.`);
        return;
      }
      const bounded = Math.max(0, Math.min(index, items.length - 1));
      cursor.current = { area, index: bounded };
      const end = index >= items.length ? 'That was the last one. ' : '';
      say(end + readItem(area, items[bounded], `${bounded + 1} of ${items.length}`));
    }

    /** Reads a decision back, and does it only after a yes. */
    function confirm(question: string, run: () => Promise<string>): void {
      latest.current.ozi.listenFor(`${question} Say yes to confirm.`, (answer) => {
        if (!YES.test(answer)) {
          say('All right, nothing was done.');
          return;
        }
        run()
          .then(async (done) => {
            await load();
            latest.current.onChanged(done);
            const area = cursor.current?.area;
            const left = area ? waiting(lists.current, area).length : 0;
            say(
              `${done} ` +
                (area && left > 0
                  ? `There ${left === 1 ? 'is' : 'are'} ${left} more. Say "next" to hear ${left === 1 ? 'it' : 'the next'}.`
                  : 'That is everything here.'),
            );
            if (area) cursor.current = { area, index: 0 };
          })
          .catch((failure: unknown) =>
            say(
              failure instanceof Error
                ? failure.message
                : 'That did not work. Nothing was changed.',
            ),
          );
      });
    }

    function needs(area: StaffArea): boolean {
      if (cursor.current?.area === area && current()) return true;
      say(
        `First, say "read me the ${AREA_WORDS[area].tab.toLowerCase()}", and I'll read them one at a time.`,
      );
      return false;
    }

    function handle(text: string): boolean {
      const { staffKey: key, by: who, areas: mine } = latest.current;
      const command = understand(text);
      if (!command) {
        if (nameHeardIn(text)) say(`Sorry, I didn't catch that. ${help(mine)}`);
        // Nothing said in the admin panel is ever taken as a shopping order.
        return true;
      }
      switch (command.kind) {
        case 'help':
          say(help(mine));
          return true;
        case 'summary':
          void load().then(() =>
            say(summary(latest.current.name, latest.current.title, mine, lists.current)),
          );
          return true;
        case 'sign-out':
          say('Signing you out. Goodbye.');
          latest.current.onSignOut();
          return true;
        case 'open':
          if (!mine.includes(command.area)) {
            say(`${AREA_WORDS[command.area].tab} isn't part of your job, so I can't open it.`);
            return true;
          }
          latest.current.onOpen(command.area);
          void load().then(() => readAt(command.area, 0));
          return true;
        case 'next':
        case 'previous':
        case 'again': {
          const at = cursor.current;
          if (!at) {
            say('Say "read me the" and a list first, such as the complaints.');
            return true;
          }
          readAt(
            at.area,
            at.index + (command.kind === 'next' ? 1 : command.kind === 'previous' ? -1 : 0),
          );
          return true;
        }
        case 'decide': {
          if (!needs('problems')) return true;
          const report = current() as StaffProblem;
          const decide = (pence: number): void =>
            confirm(
              `Decide that ${DECISION_WORDS[command.decision]}${pence > 0 ? `, and refund ${money(pence)}` : ', with no refund'}?`,
              () =>
                decideProblem(key, report.id, {
                  decision: command.decision,
                  refundPence: pence,
                  note: 'Decided by voice.',
                  by: who,
                }).then(() => 'Decided.'),
            );
          if (command.refundPence !== null) {
            decide(command.refundPence);
          } else {
            latest.current.ozi.listenFor(
              'How much should be refunded? Say an amount, or none.',
              (answer) => {
                const pence = /\b(none|nothing|no refund|zero)\b/i.test(answer)
                  ? 0
                  : spokenMoney(answer);
                if (pence === null) say("I didn't catch an amount, so nothing was done.");
                else decide(pence);
              },
            );
          }
          return true;
        }
        case 'accept':
        case 'reject': {
          if (cursor.current?.area === 'partners' && current()) {
            const product = current() as StaffPartnerProduct;
            const approve = command.kind === 'accept';
            confirm(
              `${approve ? 'Accept' : 'Turn down'} ${product.name} from ${product.shopName}${approve ? ', so Shoppers can see it' : ''}?`,
              () =>
                decideStaffPartnerProduct(key, product.id, approve).then(() =>
                  approve ? 'Accepted. It is live now.' : 'Turned down.',
                ),
            );
            return true;
          }
          if (!needs('documents')) return true;
          const doc = current() as StaffDocument;
          const decision = command.kind;
          const send = (expiresOn?: string): void =>
            confirm(
              `${decision === 'accept' ? 'Accept' : 'Turn down'} ${doc.runner?.name ?? 'this Runner'}'s ${doc.name}${expiresOn ? `, ending ${new Date(expiresOn).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}?`,
              () =>
                reviewDocument(key, doc.id, {
                  decision,
                  by: who,
                  ...(expiresOn ? { expiresOn } : {}),
                }).then(() => (decision === 'accept' ? 'Accepted.' : 'Turned down.')),
            );
          if (decision === 'accept' && doc.kind === 'insurance') {
            latest.current.ozi.listenFor(
              'When does the insurance end? Say the date, such as 31st March 2027.',
              (answer) => {
                const date = spokenDate(answer);
                if (!date) say("I didn't catch a date, so nothing was done.");
                else send(date);
              },
            );
          } else {
            send();
          }
          return true;
        }
        case 'write-off': {
          if (!needs('owed')) return true;
          const row = current() as StaffRecovery;
          if (!row.canWriteOff) {
            say(
              `${money(row.remainingPence)} is too much to write off. Please ask ${row.runner.name} for it.`,
            );
            return true;
          }
          confirm(`Write off the ${money(row.remainingPence)} ${row.runner.name} owes?`, () =>
            writeOffRunner(key, row.runner.id, who).then((result) => result.message),
          );
          return true;
        }
        case 'not-found': {
          if (!needs('finds')) return true;
          const row = current() as StaffFindRequest;
          confirm(
            `Tell ${row.shopperName} that ${row.description} could not be found${row.feePence > 0 ? `, and give back the ${money(row.feePence)}` : ''}?`,
            () =>
              decideFind(key, row.id, { found: false, note: 'None of the shops had it.' }).then(
                () => 'Done.',
              ),
          );
          return true;
        }
        case 'found': {
          if (!needs('finds')) return true;
          const row = current() as StaffFindRequest;
          const voice = latest.current.ozi;
          voice.listenFor(
            'What did you find? Say it as it should appear, such as Welsh cakes, 6 pack.',
            (found) => {
              voice.listenFor('Which shop?', (shop) => {
                voice.listenFor('How much was it?', (price) => {
                  const pence = spokenMoney(price);
                  if (pence === null || pence <= 0) {
                    say("I didn't catch a price, so nothing was done.");
                    return;
                  }
                  confirm(
                    `Found: ${found}, at ${shop}, for ${money(pence)}, for ${row.shopperName}?`,
                    () =>
                      decideFind(key, row.id, {
                        found: true,
                        name: found.trim(),
                        shop: shop.trim(),
                        pricePence: pence,
                      }).then(() => `Done. ${row.shopperName} can now add it to their basket.`),
                  );
                });
              });
            },
          );
          return true;
        }
        case 'rung-back': {
          if (!needs('enquiries')) return true;
          const row = current() as StaffEnquiry;
          confirm(`Mark ${row.organisation} as rung back?`, () =>
            markEnquiryHandled(key, row.id).then(() => 'Marked as rung back.'),
          );
          return true;
        }
      }
    }

    voice.setPageCommands(handle);
    void load().then(() => {
      if (!cancelled)
        say(
          summary(latest.current.name, latest.current.title, latest.current.areas, lists.current),
        );
    });
    return () => {
      cancelled = true;
      latest.current.ozi.setPageCommands(null);
    };
    // Once per person signed in: everything else is read through `latest`.
  }, [staffKey]);

  return null;
}
