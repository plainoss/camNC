# Saved assistant tasks

`src/tasks/catalogue.ts` holds the nine trial turns verbatim, their exact starting
designs and the requested outcomes. The expectations were written from each request;
the old candidates are not accepted as golden answers. A1 and H1 intentionally share
the same request, since the trial ran two models. The starting documents and recordings
here are self-contained and need no `work/` or private repository files.

Run `pnpm --filter @wbcnc/cad-script tasks --list` to see the briefs, or
`pnpm --filter @wbcnc/cad-script tasks --replay --out test-results/saved-tasks`
to check the recorded attempts against today's API. `--task A1` selects one and
`--max-checks 8` sets the repair limit. The recordings preserve errors and unsupported
requests; their only migration is explicit `newPart` calls where they create parts.
`offer.cad.ts` preserves what the trial offered. The replay checks numbered attempts
and then offers the last candidate. It does not silently improve those scripts.

`runCadTask` takes a model adapter and an execution adapter. The model receives the
request, history, attachment references, starting design and feedback from every
attempt. The execution adapter runs each whole script against a fresh copy of that
same start. Proposing a failed or absent candidate fails, and checks are bounded.
The runner neither applies a document nor writes a program. A browser provider can
use the same loop with its isolated checker; the replay CLI imports trusted,
committed scripts only.

Results distinguish automatic passes, failures, unanswered clarification, exhausted
runs, cancellation, errors and candidates needing human review. Reports include the
check counts, measured facts and elapsed time. `tasks --compare first/tasks.json
second/tasks.json` groups multiple runs by model without counting a pending visual or
construction review as a pass. Different model adapters should use distinct IDs.

The extra whole-piece briefs cover a thin stool request, a shelf described in words
and a shelf from an authored drawing. They have no historical recordings. The stool
requires dimensions and joints to be agreed. The drawing is a task input, not a
generated expected output. Visual resemblance and construction claims stay pending
until a person reviews evaluated outlines and cuts. These extra briefs are regression
inputs; their detailed dimensions were authored for the suite, not supplied in the
original user request.

Passing these tasks demonstrates design behaviour only. It does not establish the
strength of furniture or approve machining.
