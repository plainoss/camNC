# Handover: cupboards as folders, and the in-app chat

Written 2026-11-10 for the agent that implements both. Read the two plans first; this
adds what they don't say: the order across both, where the code is, what a trial run
showed, and what is still open. Line numbers are as of `aa554c3` on main and will drift.

## This branch

You are on `cupboards-and-chat`, cut from main at `aa554c3`. The user chose a separate
branch to work on rather than merging to main already, so continue here: commit and push
to this branch, at least every two hours. Ask the user before opening a PR from it
into main or merging anything.

`work/` holds this handover and the trial's files. It exists for this branch; move what
should last (the saved tasks of A13) into `packages/cad-script` before anything goes to
main.

## The plans

Both are merged (plainoss/camNC #459 and #463).

- `docs/CAD_ROADMAP.md`, "Milestone 5: cupboards as folders": roadmap PRs 20 to 25.
- `docs/CAD_AI_PLAN.md`, "In-app chat": steps 7 to 14, and "Safety".
- `docs/CAD_AI_FURNITURE.md`, "The fifth run, a simulated chat": what a trial of the chat
  on today's script tools found.

In one sentence each:

- **Cupboard:** Insert → Cupboard runs a script on the open design and leaves a folder of
  ordinary steps driven by the folder's variables. Nothing remembers it is a cupboard and
  nothing regenerates it.
- **Chat:** a dock where a model, on the user's own key, writes a script against a copy
  of the open design, checks it, and offers a result the user previews and applies as one
  undo step.

## Rules that are already decided

Do not reopen these without the user.

- The saved design stays ordinary parts, steps and variables. No controller record, no
  bindings registry, no rerunning a generator over edited parts.
- A script is not kept after it runs.
- Applying is the user's action. It is never a tool the model has.
- The model's key goes from the browser straight to the provider. No camNC server sees
  it or the design.
- An agent only changes a design. A program is still made after Finish, through CAM's own
  acceptance. Other agent tools stay in demo mode.
- The model uses scripts against `@wbcnc/cad-script`, not a new command language. The
  batched JSON form is the fallback if isolating scripts in the browser fails.
- The right-hand dock is the chosen layout for the assistant.

## A requirement added after the plans merged

The user, 2026-11-10: the assistant should handle requests like "build a shelf that looks
like x" or "build a stool", not only changes to what is open. The plans don't say this
yet. Amend `docs/CAD_AI_PLAN.md` in your first PR that touches the chat, with these
consequences:

- **Whole pieces from a sentence are a first-class case.** The trial's two (a shoe bench
  and a bookshelf) were right on the first check, and the earlier furniture runs in
  `docs/CAD_AI_FURNITURE.md` built a stool, a plant stand and a nightstand from the README.
  So this works on today's tools for pieces close to an example. Pieces with legs, angles
  or curves lean on what that doc lists under "Where it falls short".
- **"Looks like x" can mean a picture.** A12 needs a way to attach an image to a message,
  and A11 has to say for each model whether it reads images. The merged step 11 dropped
  that when the views moved to the end; put it back.
- **Looks are judged by eye.** For these requests the model needs to see its result, so
  A14 (views, with cuts and outlines, not boxes) moves ahead of A12 for this case. The
  trial only showed that box views add nothing to checking sizes.
- **A new piece arrives as a folder** (R20, R24), named for what it is, beside whatever is
  already open.
- **Ask before building when the request is thin.** "A stool" has no sizes. The assistant
  should state the sizes and joints it chose, or ask, as A12 allows.
- **Saved tasks (A13) need these too:** at least a stool, a shelf from a short
  description of its look, and one from a picture, each with outcomes a person stated.

## Order across both plans

Each line is one PR unless it says otherwise. "R" is a roadmap PR, "A" an AI plan step.

1. **A9, change a design from a script.** Headless, no UI, and the largest gap the trial
   found. Do this first.
2. **A13, saved tasks.** Turn the trial's nine requests into a repeatable run, so every
   later script API change is measured. Start from `work/chat-poc` (see below).
3. **R20, folders**, then **R21, folder variables.**
4. **A7, apply an outside document**, then **A8, preview a candidate.** Both the chat and
   Insert → Cupboard need them.
5. **R24, script folder scope**, then **R25, Insert → Cupboard.**
6. **R22, a feature on one copy** (starts with a spike), then **R23, detach a copy.**
7. **A10, check in the browser**, **A11, provider connection**, **A12, the dock.**
8. **A14, views.** Before A12 if "looks like x" requests are in the first release of the
   dock, as the requirement above asks; otherwise once a saved task needs them.

1 and 2 can run beside 3. 6 is independent of 4 and 5. 7 needs 4 and 1.

## Where the code is

### Design model, `packages/cad/src`

- `types.ts`: `CadDocument` (`version: 1 | 2`, `variables`, `partCuts`, `planes`, `parts`),
  `CadPart`, `CadPartCopy`, `CadPartPattern`, `CadVariable`, `CadPartCut`.
- `designSteps.ts`: `designSteps(document)` at line 51 derives the flat feature list from
  the order of `document.parts`; a cut-parts step lands after its last part.
  `rolledBackTo` at line 218 works on step IDs. A folder must be a view over this list,
  not a change to it. `DesignStep.partId` is required and assumed widely, so a folder row
  should not be a `DesignStep`.
- `suppression.ts`: `activeDesign` at line 9. Folder suppression belongs here as a mask
  over each step's own flag.
- `partPatterns.ts`: a pattern copy's ID is `<pattern id>:<index>`, so a count of
  3 → 2 → 3 gives the same third copy back. Its name is lost when the count drops, since
  names are only carried over from copies that still exist.
- `variables.ts`: `setCadVariable` at line 633. Names are unique across the document, and
  a rename rewrites every expression. R21 keeps that and adds only the folder a variable
  belongs to.
- `parseCadDocument.ts` line 17 and `features.ts` `withFeatureVersion` at line 30: the
  version is 2 only while some part has features. A folder needs a new version, and
  `withFeatureVersion` must not downgrade a document that has one.
- `:` separates part and copy IDs in several places (`CadPartCut.tools` takes
  `<partId>:<copyId>`). Keep part IDs opaque.

### Studio UI, `apps/camNC/src/cad`

- `FeatureList.tsx`: flat list; line 289 marks every step of the selected part as
  current. R20 needs real step and folder selection.
- `PartsList.tsx`: the bodies. Group by folder here too.
- `reorderSteps.ts`: moves a whole part, or a face feature within one part. A folder
  drags as a block of parts.
- `CadEditor.tsx`: over the file-size cap (`scripts/file-size-ceilings.json`), so it may
  only shrink. New work goes in its own modules with small wiring edits here.
- `CadVariablesPanel.tsx`, `VariableDialog.tsx`: where a folder's variables would show.

### Editor session, `packages/cad-editor/src/session.ts`

- `commitCadSession` (line 66) and `replaceCadSession` (line 88) already take a whole
  document as one undo step. A7 is a guarded entry to these from outside the editor, plus
  the wiring in the studio. `docs/CAD_AI_PLAN.md` still says the editor takes no outside
  changes; update it when A7 lands.

### Scripts, `packages/cad-script/src`

- `edit.ts`: `editCad(start, script)` at about line 859 runs a script on a copy and
  returns the design unchanged when the script stops. `DesignEdit` at line 180 and
  `PartEdit` at line 122 are the API. `d.part(name)` finds or makes; `part.remove` takes
  only a cut.
- `cli.ts`: the `check` command. `typecheck.ts` shells out to `tsc` and is Node only.
- `mcp.ts`: the four MCP tools. The chat should offer the same ones.
- `render.ts`: `renderCadSvg`, each part from above. `fullReport.ts`: the full report.
- `examples/cupboard.cad.ts`: the script Insert → Cupboard will run. Its shelf is one
  part on pins; R24 gives it a `shelves` variable and a pattern.
- `README.md` is the guide a model reads. It covers building, not changing.

### CAM and app

- `apps/camNC/src/cam/cadDesign.ts` line 42: mirrored copies are parts of their own to
  CAM, plain copies add to a quantity. R22 makes a copy with its own feature a part of
  its own in the same way.
- `apps/camNC/src/cam/designGeometry.ts`: geometry keys. Adding, renaming or removing a
  folder must leave every key unchanged.
- `apps/camNC/src/store/store.ts` and `store-storage.ts`: the settings store is written to
  localStorage and synced to the server (`worker/index.ts`, `/api/settings`), and is what
  a settings backup exports. The key must not go in it. Stores built on `demoStorage`
  stay local.
- `apps/camNC/public/_headers`: `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`. There is no content security policy. A10's
  isolated frame has to work under these headers; that is untested.
- `apps/camnc-desktop`: the Tauri build, which can make a provider call natively if a
  provider refuses calls from a browser.
- There is no LLM client code or dependency in the repo yet.

## What the trial showed

Nine requests, each run by a fresh agent with only the README, the examples and two
tools. Full table in `docs/CAD_AI_FURNITURE.md`.

Works today:

- Changing an open design with a short script, keeping every existing ID. Resizing the
  cupboard and adding two shelves took 8 lines and kept all 143 IDs.
- Variable changes, and simple box furniture from a sentence, on the first check.

Does not, and which step fixes it:

| Finding                                                                | Fix                       |
| ---------------------------------------------------------------------- | ------------------------- |
| A script can remove only a part's own cut, and can't change a step     | A9                        |
| `d.part('Shelf 2')` makes an empty part when no part has that name     | A9                        |
| The README doesn't say how to reach an existing corner, cut or step    | A9                        |
| The report lists every pattern copy: 56 pin holes make 31 KB           | A9                        |
| A hole in one shelf only can't be said                                 | R22, plus a script target |
| The cupboard script can't run twice; the agent copied it into 41 lines | R24                       |
| A check passed on a bench whose housings had been set to zero depth    | A8, cost of a change      |
| A request that fights the design had no way to become a question       | A12                       |
| What the user asked for earlier isn't in the design                    | A12                       |
| A mistyped option without the type check gives "reading 'trim'"        | A10, argument checks      |

Front, right and top views of the boards as boxes caught no mistake, which is why A14 is
last.

## The trial's files

In `work/chat-poc` on this branch. Drawings and check reports are not committed;
`tool.mjs` writes them again on each check.

- `tool.mjs`: `context <conversation>` prints the open design's report, and
  `check <conversation> <turn> <script>` runs a script on a copy and logs the attempt.
- `ids.mjs <before.json> <after.json>`: which IDs survive an edit. Useful for A7's test.
- `notypes.ts`: runs a script with no type check, as the browser will.
- `A`, `B`, `C`, `H`: one folder per conversation, with `design.json`, and per turn the
  offered script, the design it made (`candidate.json`), every attempt's script, and
  `log.jsonl`.
- `RESULTS.md`: the run in full, with each request word for word and the design it
  started from.

For A13, state each expected outcome independently of the current output.

## Open points

- **R22 spike.** Features are saved on the part and shared by its copies. What a feature
  on one copy costs in evaluation and CAM is unknown. If it doesn't fit, R23's detach
  covers the case alone.
- **A likely bug.** After `d.variable('width', …)`, `regionAt` in the same script finds
  regions where the old width put them. Seen in `work/chat-poc/B/turn2/attempts/5` to `7`,
  not reproduced on its own and not filed. Reproduce it, add the failing input as a test,
  and fix it with A9.
- **Provider calls from a browser.** Not checked for any provider. Check each provider's
  current documentation before A11, with `ctx7` as the user's rules require.
- **The isolated frame** under the app's cross-origin headers. Try it early in A10.
- **Folder behaviour in the studio.** The user's standing rule is to match the established
  reference behaviour by default and to check it before building. Do that for folders,
  rollback into a folder and pattern instances before R20 and R22, and keep the notes in
  the private companion repository.
- **Views with cuts.** Only boxes were tried.
- **Models.** The trial used one mid-size model, and a small one for one request. A13 is
  where others get compared.

## Working in this repo

From `AGENTS.md`; read it in full.

- pnpm only. Locally run `pnpm run test:fast` plus the test files for what you changed,
  and `pnpm run check-types`. Leave the full run to CI. Report only what ran.
- Part Studio work goes through `pnpm --silent cad:iterate` and `cad:iterate:ui`
  (`docs/CAD_ITERATION.md`). Reproduce a problem headlessly before opening a browser:
  `pnpm --silent --filter @wbcnc/cad-script check --from design.json --report full`.
- Every change comes with tests. A saved design becomes a golden report in
  `packages/cad-script/fixtures/designs/`.
- A new tool, feature or dialog goes in its own module. Source files are capped at 1000
  lines; files over it may only shrink.
- `docs/STATUS.md` is generated. Edit its sources and run `pnpm run status`.
- PR titles: `feat(cad) Title`, `fix(camNC) Title`. Keep CI changes out of feature PRs.
  PR text describes the concrete change only: no comparisons with other applications.
- To merge, comment `@mergifyio queue` on the PR and check the Mergify check. Don't use
  GitHub auto-merge.
- Push at least every two hours on long work.
- When a PR lands, tick it off in the plan it came from and correct the plan where the
  code proved it wrong.
