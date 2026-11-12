# Live assistant harnesses

Two opt-in harnesses send real provider requests through the app's own assistant code and record what came back:

- **Design assistant** (`src/cad/assistant/live/`): runs the production design loop on saved tasks with the real sandboxed check, answers up to two questions with "use your recommended choice", and assesses the final proposal.
- **Carving assistant** (`src/cam/carvingAssistant/live/`): generates carving drawings for a fixed set of briefs and checks each one with the app's carving preparation (sanitize, fit, lost cut area, narrow and fragile lands).

They cost money, so they are not part of any suite: the files end in `.live.ts`, which no default include matches, and each test skips unless its opt-in variable is `1`.

## Running

From `apps/camNC`, with `OPENAI_API_KEY` (or `GEMINI_API_KEY` for a `gemini-*` model) in the environment:

```sh
ASSISTANT_LIVE=1 ASSISTANT_LIVE_REPS=3 pnpm vitest run --config live-assistant.vitest.config.ts
CARVE_LIVE=1 CARVE_LIVE_BRIEFS=owl,cat CARVE_LIVE_REPS=1 pnpm vitest run --config live-carve.vitest.config.ts
```

Settings shared by both, with the prefix `ASSISTANT_LIVE` or `CARVE_LIVE`:

| Variable               | Default                       | Meaning                                                                         |
| ---------------------- | ----------------------------- | ------------------------------------------------------------------------------- |
| `<prefix>`             | unset                         | `1` runs the harness; anything else skips it.                                   |
| `<prefix>_MODEL`       | `gpt-5.4-mini`                | Model; a name starting with `gemini` uses Gemini's OpenAI-compatible endpoint.  |
| `<prefix>_REPS`        | 3 (design), 2 (carving)       | Repetitions per task or brief.                                                  |
| `<prefix>_LABEL`       | `run`                         | Subfolder for this run's records, for comparing runs before and after a change. |
| `<prefix>_OUT`         | `test-results/live/<harness>` | Output directory, holding the ledger and every label's records.                 |
| `<prefix>_BUDGET_USD`  | 2                             | Spend cap for everything booked in this output directory's ledger.              |
| `<prefix>_RESERVE_USD` | 0.03                          | Amount held against the budget for each call in flight.                         |
| `<prefix>_CONCURRENCY` | 4                             | Tasks or briefs run at once.                                                    |

Design assistant only:

- `ASSISTANT_LIVE_TASKS`: comma-separated saved-task ids (`packages/cad-script/src/tasks/catalogue`) plus `tall-narrow` and `bar-stool`. Default `A1,A2,A3,B1,C1,shelf-description,tall-narrow,bar-stool`.
- `ASSISTANT_LIVE_REPLIES`: how many assistant questions are answered automatically (default 2).

Carving assistant only:

- `CARVE_LIVE_BRIEFS`: comma-separated brief ids from `carve.live.ts` (default: all eight).
- `CARVE_LIVE_FROM=<label>`: re-evaluates the first drawings saved under that label with the current code instead of generating new ones. No provider call unless repair is on.
- `CARVE_LIVE_REPAIR=1`: one automatic repair turn for each first drawing the checks reject, sent with the findings through the app's existing revise path.
- `CARVE_LIVE_EFFORT`, `CARVE_LIVE_MAX_OUT`: reasoning effort and output-token limit passed to the provider.

## Keys and budget

Provider keys never enter the test page. The page sends requests with a placeholder key; the Node-side `liveProviderFetch` command (`commands.ts`) drops the page's headers, adds the key from the environment, and only talks to the OpenAI and Gemini API hosts. Only variables with the harness's own prefix reach the page, and never ones naming a key, token or secret.

Every call is priced from its reported usage into `ledger.json` in the output directory. A call is refused (HTTP 402 to the app) when the spend so far, plus the reservations of calls in flight, plus its own reservation, would exceed the budget. A call that timed out without a response is booked at its reservation, since it may still be billed. Transient failures (429, 5xx, network) are retried up to three times, each attempt passing the budget check. The ledger keeps adding up across runs into the same directory: delete it, or choose a new `_OUT`, to start a fresh budget.

## What is recorded

- Design: `<label>/<model>-<task>-<rep>.json` per run with status, stop reason, questions asked, whether a proposal was made and passed the automatic assessment (and each check), request and check counts, script errors, token counts, cost, latency, the final reply and the transcript.
- Carving: `<label>/<brief>-r<rep>-first.svg|json` (and `-repair` when repaired) with tokens, cost, latency and the evaluation (accepted, preparation errors and warnings, removed cut area, narrow and fragile land, located findings in viewBox units), plus `<label>/records.json` for the whole run.
- Both: `ledger.json` with every provider call's model, tag, status, usage and cost. Error bodies are cut to their message.

## Cost

On `gpt-5.4-mini`, a design run (one task, one rep, several requests) costs about USD 0.03, so the default eight tasks × three reps is about USD 0.75. A carving generation is one call of about USD 0.006–0.008, so all eight briefs × two reps is about USD 0.10, plus repairs. The default USD 2 budget covers either full run with room to spare.

The configs are named `live-*.vitest.config.ts` rather than `vitest.*.config.ts` on purpose: they never run in CI, so they don't register the Mergify reporter that `scripts/ci-config.test.mjs` requires of every CI config.
