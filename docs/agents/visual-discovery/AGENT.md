# Visual discovery agent

Find and document visual and everyday workflow defects in camNC. Produce useful
issues and retained investigation evidence; leave product repairs to a separate
assignment. These instructions work with any agent runner that can control a
browser, inspect screenshots and write files.

## Start

From a checkout of this repository, give an agent one of these instructions:

> Follow `docs/agents/visual-discovery/AGENT.md` in **ONE PASS** mode.

> Follow `docs/agents/visual-discovery/AGENT.md` in **PERSISTENT** mode.

Provide tracker authorization if publishing issues is wanted; otherwise produce
complete drafts. A scheduler invokes ONE PASS. PERSISTENT needs a runner that can
remain alive and wait; these instructions alone do not start a daemon.

## Configuration and durable state

Read [config.json](config.json) relative to this file. Resolve the repository from
the checkout containing these instructions. Keep instructions and configuration
read-only during routine passes.

Resolve the writable state directory from `CAMNC_REVIEW_STATE_DIR`, defaulting to
`${XDG_STATE_HOME:-$HOME/.local/state}/camnc-ui-discovery`. Scheduled and persistent
runners reviewing the same repository must share this directory. For cloud runs,
mount durable storage there; an ephemeral filesystem does not preserve history.
Keep ledgers, locks, screenshots and traces out of tracked source files.

Acquire `review.lock/` with atomic directory creation before reading or updating
`ledger.json`. Store hostname, PID, process start time, run ID and heartbeat in
`review.lock/owner.json`. Skip a live owner; never steal ownership on age alone.
Establish that the original process/run ended, accounting for PID reuse, before
recovering its lock. Release ownership on exit or interruption; a persistent
runner retains it while alive.

Initialize a missing ledger with version 1 and empty coverage, findings, pending
actions and runs. Preserve existing state. Only the coordinator updates the ledger
or publishes tracker changes; subagents write evidence to separate run folders.
Checkpoint after each finding and tracker mutation using temporary-file write
and atomic rename. Record intended mutations before sending them; search the
tracker before retrying an interrupted or uncertain response.

## One pass

1. Preflight browser, screenshots, WebGL, server and durable attachment capabilities.
   Reconcile current main, issues and active PRs with the ledger. Record source
   revision, browser version, OS, viewport and target. Use an isolated checkout or
   identified test build; preserve other work. Reserve the configured final portion
   of the budget for verification, attachments and checkpointing.
2. Select distinct woodworking goals from the rotation, prioritizing changed or
   neglected interactions. Delegate to the configured number of explorers when
   available. Give outcomes and constraints, not click scripts or suspected bugs.
   Use separate synthetic projects/browser contexts. Without subagents, explore
   sequentially and record reduced independence.
3. Drive visible controls in headless Chromium using Playwright or an equivalent
   portable driver. Reuse the [behavior-spec tools](../../../apps/camNC/e2e/spec/README.md)
   where helpful. `spec:session` is sketch-only; studio commands need the studio
   adapter. Use actual canvas picks when testing picking. Do not replace a failed
   UI operation with internal state mutation.
4. Record trace and exact actions from the first action. Capture screenshots before
   and after meaningful edits, while preview fields are focused, and after
   confirm/cancel/undo/reopen. Inspect actual pixels for outlines, highlights,
   geometry, occlusion and layout. Wait for observable solver/render readiness;
   transient incomplete frames are not automatically defects.
5. Preserve the complete workflow, genuine UI-downloaded BEFORE and AFTER designs
   under distinct filenames, and creation/preview/history steps. Loading only a
   final design can hide rendering-state failures. Canonical comparison JSON is
   not necessarily an importable design. Reduce a case without discarding its
   original project.
6. Prefer a different verifier subagent to reproduce each strong candidate in a
   fresh context and inspect screenshots. Otherwise perform a separate fresh-context
   replay and label it a same-agent repeat. Record positive and negative results. State the
   expectation source: user requirement, documented behavior, accepted reference
   contract, or an internally inconsistent visible result. Unexplained confusion
   remains a usability observation; screenshots alone do not establish root cause.
7. Search issues and active PRs again. Within operator authorization, file verified
   new defects with embedded before/after screenshots, a valid pre-failure design,
   exact steps, expected/actual, impact/workaround, environment and verification
   limits. State reproduction independence honestly. Add materially new evidence
   to existing issues instead of duplicating them. Retain uncertain findings with
   their next experiment. If durable uploads are unavailable, retain a complete
   draft rather than filing an issue whose evidence exists only at local paths.
8. Checkpoint coverage, findings, fingerprints, issue/PR links, artifact locations,
   failed attempts, blockers and next tasks. Stop within the pass budget and issue
   limit. ONE PASS exits. PERSISTENT waits between bounded passes, checks relevant
   changes at the configured interval and explores at least daily even without
   changes. If the runtime cannot remain alive or wait, checkpoint and exit honestly.

## Scope and reporting

Follow [CAD iteration](../../CAD_ITERATION.md) for full-workflow evidence and the
separate UI, parametric, material and mesh claims. Use synthetic, self-contained
projects. Keep private references and external application comparisons in the
private companion repository. Exclude credentials, unrelated user content and raw
authenticated traces from uploads.

Do not change application code, tests, CI, deployments or real CNC machine state, or close
unrelated issues. Classify tooling failures separately from product defects. Stop
unproductive investigations after bounded attempts, preserve the next experiment
and continue independent work. Script completion or saved expressions do not prove
visual correctness.

Keep clean runs and unchanged blockers quiet. Report new actionable findings/issues,
materially changed verification, new failures or required input; include issue links
and a clear screenshot for visual defects. Never claim monitoring continues after
the process or scheduler stops.
