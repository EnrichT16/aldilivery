# Ozi's memory (17 October 2026, ruling 68)

What changed, for whoever picks this up next.

- **New table** `OziExchange` (`packages/api/prisma/migrations/20261026090000_ozi_memory`): one row per exchange with Ozi on any channel. Written by `remember()` in `packages/api/src/lib/ozi-memory.ts`, which scrubs numbers, cards, codes, emails and postcodes, drops anything with a banned word, codes the conversation one-way, and never throws.
- **Written from** `POST /ozi/reply` (server answers), `POST /ozi/heard` (what the app said on its own; called fire-and-forget from `useVoiceOrdering`), the telephone line's `reply()` in `packages/api/src/routes/telephone.ts` (every turn of every call), and the text line.
- **The telephone answers from the phrase book** before saying "I couldn't find": `liveBook(app)` exported from `packages/api/src/routes/ozi.ts` is the same book the app uses, learned answers included.
- **Judging**: `GET /staff/memory` (filters `verdict`, `channel`; counts), `POST /staff/memory/:id` (`verdict` right or wrong, optional `betterReply`; a better answer becomes an approved learned phrase and is taught live), both under the `learning` area. The screen is the `Memory` component under the Learning tab in `packages/web/src/pages/Staff.tsx`.
- **Export**: `GET /staff/memory/export` (owner only) returns `{ count, lines }`, each line a JSON object (`prompt`, `completion`, `said`, `verdict`, `brain`, `outcome`, `channel`, `account`, `conversation`, `turn`, `at`). The panel downloads it as `.jsonl`.
- **Retention**: unrated rows after 180 days, rated after 3 years, in `sweepRetention` (`exchangesRemoved`). The privacy page says so.
- **Tests**: `packages/api/test/ozi-memory.test.ts`; a ruling 68 case in `packages/web/test/voice-order.test.tsx`.

To plug a model in later: answer inside `POST /ozi/reply` after `phraseReply` returns null, record it with `brain: 'model'` (add the word to `BRAINS`), and keep the two-and-a-half-second limit.
