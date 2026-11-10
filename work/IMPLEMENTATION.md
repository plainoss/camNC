# Cupboards and chat: implementation handover

Updated 2026-11-10. Work belongs to `cupboards-and-chat`; no PR was opened and main
was not changed. Keep committing and pushing there. Ask before opening a PR into
main or merging. This worktree is detached because another worktree holds the
branch; its implementation commits are pushed to `origin/cupboards-and-chat`.

## Implemented

- A9/A13: explicit existing-part lookup and new-part creation, existing feature
  edits/removals, current geometry after variable edits, compact pattern reports,
  and twelve saved tasks with independent outcomes and bounded recorded replay.
- R20/R21/R24: folders, folder variables, suppression/rollback/movement/deletion,
  scoped scripts, unique variable suffixes, and a reusable cupboard builder.
  Saved designs contain ordinary steps and variables; no generator is retained.
- R22/R23: copy-specific sketches/cuts, dormant features when a pattern instance
  disappears, separate CAM grouping when geometry differs, and detaching copies.
- A7/A8/R25: shared candidate comparison and 3D preview, lost-cut/joint warnings,
  guarded application as one undo step, and Insert → Cupboard. A hand edit makes a
  proposal stale, including when that edit is subsequently undone.
- A10–A12/A14: isolated browser script checking, runtime argument checks, a right
  assistant dock, direct provider adapters, reference images, conversation context,
  Stop, bounded repair attempts, evaluated views and named-cut sections.
- MCP exposes `insert_cupboard`; `check_design` returns requested SVG views as
  resources. Neither the assistant nor MCP makes or accepts machine programs.

## Try it

From the repository root, with the Node version in `.nvmrc` and pnpm installed:

```sh
pnpm --filter @wbcnc/camNC dev
```

Open the URL printed by Vite, create or open a design, and enter the Part Studio.
Choose **Insert → Cupboard**, enter dimensions and shelf count, preview, then
**Apply as one undo step**. Insert again for an independent cupboard. The folder's
Settings edits its variables. Copies offer sketch/cut and detach actions.
**Insert → Review design file** opens the same guarded preview for an outside
candidate carrying the open design's ID. Undo restores the preceding document.

Open **Assistant → Connection**. Choose Anthropic or OpenAI compatible, enter the
API address, model ID and your own key, and select the supported API protocol.
Confirm tool support; enable image support for a model that reads images, then
choose **Use connection**. Keys stay in memory unless **Remember key on this
device** is selected; remembered keys use separate local storage, outside settings
sync and backups. Requests go directly to the provider. **Forget key** clears it.
Ask for an edit or whole piece; attach a reference image when enabled. Review and
apply remain user actions. Unspecified stool dimensions/joints require a question
or proposed choices before building.

```sh
pnpm --filter @wbcnc/cad-script tasks --list
pnpm --filter @wbcnc/cad-script tasks --replay --task A1 --out /tmp/cad-tasks
pnpm --filter @wbcnc/cad-script tasks --compare /tmp/cad-tasks/tasks.json
pnpm --silent --filter @wbcnc/cad-script check --from packages/cad-script/fixtures/designs/two-cupboards.json --views /tmp/cad-views
pnpm --silent --filter @wbcnc/cad-script check --from design.json --views /tmp/cad-views --section-part PART_ID --section-cut CUT_ID --section-axis x
```

Replace section IDs with a physical part/copy ID and evaluated cut ID or unique
prefix from the report; `--section-at` selects the other local-axis coordinate.
Views write top/front/right SVGs; a section also writes `section.svg`.

## Limits and verification

- Live paid-provider calls were not run. Provider tests use recorded responses;
  actual access depends on browser CORS, account permissions and model capability.
- Recorded task replay preserves historical unsuccessful attempts; it is not a
  fresh model comparison. Visual resemblance and construction reviews remain
  explicit human outcomes. CAD validity does not establish furniture strength.
- Views are transparent contour drawings with hidden cuts visible. Mirrored
  detach snapshots evaluated outlines/cuts as fixed polygons at the evaluator's
  chord tolerance; ordinary detach preserves symbolic sketches.
- Conversation state lasts for the current app session and is not saved in the
  design. Scripts never apply, Finish, or bypass CAM's ordinary acceptance.

Verification on the committed implementation:

- Workspace types, lint, formatting and status checks: `pnpm run check-types`,
  `pnpm run lint`, `pnpm run check-format`, `pnpm run check-status`.
- Focused browser coverage includes recorded assistant and cupboard workflows,
  imported-file solve/preview/stale checks, and camera continuity at 1200, 375 and
  320 px. Toolbar controls fit 320–1440 px, including after an invalid file import.
- Three complete core workflows, 24 checkpoints: `pnpm --silent cad:iterate`,
  `--workflow divided-tray`, and `--workflow fitted-joints`.
- Production build: `pnpm --filter @wbcnc/camNC build`.
- Interface lane: `pnpm --silent cad:iterate:ui` — all eight scenarios pass.
- Saved-design goldens, task/material guards, expression lexing, copy lifecycle,
  provider protocols, sandbox restrictions and candidate acceptance focused tests.

- `pnpm run test:fast` — passed, including all 288 fast browser test files.
- The complete `pnpm run test` and performance gates were left to CI, following
  the local-machine testing instructions. No PR/CI run has been started.

Review fixes cover copy-specific parent-pocket overrides retaining nested floor
features, solved geometry before imported-file acceptance, and equal viewport
geometry across the studio/sketch toolbars. Each has a regression test.

Details: [assistant guide](../docs/CAD_ASSISTANT.md),
[script API and commands](../packages/cad-script/README.md), and
[saved-task format](../packages/cad-script/fixtures/tasks/README.md).
