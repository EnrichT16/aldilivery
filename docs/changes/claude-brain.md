# Claude behind Ozi (17 October 2026, ruling 69)

- `packages/api/src/lib/claude-brain.ts`: `OziBrain` interface and `claudeBrain()` on the official SDK (`@anthropic-ai/sdk`), model from `ANTHROPIC_MODEL` (default `claude-haiku-5-5`), four-second limit, no retries, JSON-schema answer, low effort, instructions built from `config/store.json` names and cached. `understand()` returns `{ kind, items[{name, quantity, brand, detail}], reply }` or null.
- `AppContext.brain` (null without `ANTHROPIC_API_KEY`); `/api/health` reports `brain`.
- `POST /ozi/reply` (within mode): after the phrase book, Claude; shopping comes back as `understood` with `reply: null`, a question as `reply`; questions still go to the Learning list. Body accepts `basket: string[]`.
- Telephone items step: parser, then phrase book, then Claude; `addAsked()` is the shared catalogue loop.
- Web `useVoiceOrdering`: `askWithin()` sends the sentence and basket names; Claude's items become the pending list; `needsEars()` decides when a sentence goes to Claude even though the parser found something.
- Memory brain word `claude`; staff panel shows "the language model".
- Settings: `.env.example`, `.do/app.yaml` (`ANTHROPIC_API_KEY` secret, `ANTHROPIC_MODEL`). Set a monthly spend limit on the key in the Anthropic console.
- Tests: `packages/api/test/claude-brain.test.ts`, ruling 69 cases in `ozi-memory.test.ts`, web `voice-order.test.tsx`.
