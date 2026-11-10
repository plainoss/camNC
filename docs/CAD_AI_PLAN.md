# Letting an AI build designs

How an LLM or coding agent builds and checks camNC designs, and how agents test the
app. The saved design stays the document in [the CAD roadmap](CAD_ROADMAP.md): none
of this adds a second source of truth.

## Decisions

- **TypeScript against a small API, not a new language.** Models already write it,
  `tsc` catches API misuse, and loops and functions work. The API is
  [`@wbcnc/cad-script`](../packages/cad-script/README.md).
- **A script produces an ordinary document and isn't kept.** So hand edits have
  nothing to fight with. The same `editCad` starts from an empty or existing design.
- **Verification is layered:** types, the solver, feature rules, CAM features, then
  the script's own `expect`, because a valid design isn't necessarily the one meant.
- **A design made outside the app only enters it as a new job.** New part IDs change
  the key that identifies a physical sheet, so rerunning a script over a job would mark
  its sheets out of date. The in-app chat below edits the open design instead, and
  keeps the IDs of the parts it doesn't touch.
- **No live editing yet.** The editor reads its document once and takes no outside
  changes, and designs live in the browser's IndexedDB, where no server can reach them.
  Step 7 below changes this.
- **The chat runs in the browser with the user's own key.** It calls the provider
  directly, so no camNC server sees the key or the design.
- **Only the user applies a change.** The model works on a copy and offers the
  result. Applying is not one of its tools.

## Order

1. Done: [interactive spec session](../apps/camNC/e2e/spec/README.md), so agents can
   try a UI feature without replaying a whole scenario.
2. Done: `editCad`, the report, an SVG and the `check` command.
3. Done: open a design `.json` from CAM's Open model or by dropping it. It becomes a
   new draft job marked as imported, and someone has to finish the sketch to use it.
4. Done: board planning moved from `cam.worker.ts` to `planBoard` in `packages/cam`, and
   the report summarises each part's toolpaths with it. A summary only, never a program
   file.
5. In progress: variables, placements and patterns are in the API, with a collision
   check between placed parts. Joints wait for roadmap PR 10.
6. Done: an MCP server (`pnpm --filter @wbcnc/cad-script mcp`) gives agents without a
   shell, such as Claude Desktop, the guide, the examples and the check. Designs are
   written to a folder as scripts and as documents ready to import into CAM. Next, an
   in-app chat that uses the same tools, once the editor accepts outside changes through
   its session.

## In-app chat

An assistant in a dock on the right of the Part Studio. The model reads the open
design, writes a script, checks it on a copy, looks at drawings of the result and
repairs it, then offers it. The user sees a preview and applies it as one undo step.

The model uses the tools the MCP server already has: the guide, the examples and the
check. `editCad` already runs a script against a copy and leaves the design as it was
when the script fails, so the model sends its whole script again on each try and
nothing has to track a half-built candidate.

```
Shared:  7 → 8
Chat:    9 → 10 → 11 → 12 (needs 7 and 8) → 13
```

7. **Apply an outside document.** The open design takes a whole new document as one
   undo step, through the session's existing commit, and refuses it when the design
   has changed since the document was made. **Done when:** applying a script's result
   keeps the ID and geometry key of every part the script didn't change, and a hand
   edit made in between refuses the apply.
8. **Preview a candidate.** The studio shows a candidate over the open design, with
   the steps it adds, changes and removes, before anything is applied. **Done
   when:** a candidate can be looked at from any side, then applied or dropped,
   and dropping it leaves no trace.
9. **Check a script in the browser.** The MCP server's `check_design`, run in an
   isolated frame that has no network and no storage: a design and a script go in, a
   design and a report come out. Scripts are plain JavaScript here, because the type
   check only runs under Node. **Done when:** every example checks to the same report
   as on the command line, and a script that tries to fetch or read storage fails.
10. **Views in the report.** Top, front and right drawings of the boards as placed,
    and a section through a named cut, as SVG from the evaluated geometry. They are
    made in `cad-script`, so the command line and the MCP server get them too, and
    the browser turns them into images for models that read images. **Done when:**
    the cupboard's front view shows its shelves at their heights, and a section
    through a pocket shows its depth.
11. **Connect a provider.** A key store of its own, which is never synced and never
    part of a settings backup. Two adapters: Anthropic, and OpenAI-compatible with an
    address that can be changed, which covers OpenAI, OpenRouter and most others. Each
    model says whether it can call tools, which the chat needs, and read images, which
    the views need. **Done when:** the key appears in no synced setting, backup or log.
12. **The assistant dock.** Messages, the selection as context, Stop, and a short log
    of what the model did ("floor 10 mm, wanted 12; made the pocket shallower"). A
    proposal card lists what passed and which views were looked at, opens the preview
    of step 8 and applies through step 7. A run stops after a set number of tries and
    says what it found. **Done when:** an end-to-end spec with a recorded model asks
    for a change, previews it, applies it and undoes it, and a hand edit made while
    the model works turns Apply off.
13. **Saved tasks.** Modelling tasks with their outcomes stated independently, run
    through the same loop without a browser, to compare models and to measure again
    after each API change.

### With cupboards as folders

[Milestone 5 of the roadmap](CAD_ROADMAP.md#milestone-5-cupboards-as-folders) and the
chat share work, and each makes the other more useful:

- Steps 7 and 8 are what Insert → Cupboard (roadmap PR 25) needs to run a script on the
  open design with a preview. They are built once, before either.
- A proposal that adds parts builds them into a folder (roadmap PRs 20 and 24), so it
  can be looked over, switched off or deleted as one.
- A folder's variables (roadmap PR 21) make the commonest request the cheapest: "make
  it 80 wide" changes one variable. The model can also be sent one folder and its
  variables rather than the whole design.
- The scripts behind the Insert menu are the model's vocabulary. It calls
  `cupboard({ shelves: 4 })` rather than drawing eight boards. A script the model
  writes can be saved to the Insert menu, which the isolation of step 9 makes safe.
- "A hole in the second shelf" needs a feature on one copy (roadmap PR 22), and a way
  to name that copy in a script.
- Roadmap PRs 22 and 24 change the script API, so the saved tasks run again after each.

[Designing furniture with scripts](CAD_AI_FURNITURE.md) lists what a furniture test run
found and what to improve next.

## Safety

No camNC-generated program has been cut yet, so:

- An agent only ever changes a design. A program is made from it the way it is from
  any design: after Finish, through CAM's own acceptance. The in-app chat ships on
  those terms; every other agent tool stays in demo mode and out of production builds.
- A script from a model runs where it can reach neither the network nor the app's
  storage, so it can't read the key or another design.
- `check` never writes a program, and a design that fails isn't written at all.
- Scripts state sizes and depths with `expect`.
- AI-authored programs stay uncut until the roadmap's test cut, then get an air cut first.

## Still unproven

Twelve pieces written by fresh agents from the README all passed, most within five
tries, but that's one model on tasks we chose. Measure again after each API change. The batched JSON form stays the fallback, and
any surface for an untrusted client should take data rather than code.

For the in-app chat:

- The chat takes code and relies on step 9's isolation instead. Whether that frame
  works under the app's cross-origin isolation headers is untested; the batched JSON
  form is the way out if it doesn't.
- How well models write these scripts as plain JavaScript, without the type check.
- Whether each provider accepts calls straight from a browser. The desktop build can
  make the call natively where one doesn't.
- Whether looking at drawings catches mistakes the numeric checks miss. A shaded
  picture or a second model as reviewer waits for a saved task that shows the need.
