# The language model behind Ozi (17 October 2026, ruling 69)

- `packages/api/src/lib/language-model.ts`: `OziBrain` interface and `languageModel()` on the official SDK (`@anthropic-ai/sdk`), model from `LANGUAGE_MODEL` (default the default model), four-second limit, no retries, JSON-schema answer, low effort, instructions built from `config/store.json` names and cached. `understand()` returns `{ kind, items[{name, quantity, brand, detail}], reply }` or null.
- `AppContext.brain` (null without `LANGUAGE_MODEL_KEY`); `/api/health` reports `brain`.
- `POST /ozi/reply` (within mode): after the phrase book, the model; shopping comes back as `understood` with `reply: null`, a question as `reply`; questions still go to the Learning list. Body accepts `basket: string[]`.
- Telephone items step: parser, then phrase book, then the model; `addAsked()` is the shared catalogue loop.
- Web `useVoiceOrdering`: `askWithin()` sends the sentence and basket names; the model's items become the pending list; `needsEars()` decides when a sentence goes to the model even though the parser found something.
- Memory brain word `model`; staff panel shows "the language model".
- Settings: `.env.example`, `.do/app.yaml` (`LANGUAGE_MODEL_KEY` secret, `LANGUAGE_MODEL`). Set a monthly spend limit on the key in the the model provider console.
- Tests: `packages/api/test/language-model.test.ts`, ruling 69 cases in `ozi-memory.test.ts`, web `voice-order.test.tsx`.
