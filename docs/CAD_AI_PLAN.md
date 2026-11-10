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
- **Outside edits use the session's guarded proposal entry.** A candidate for the
  open design is previewed and committed as one undo step. A newer local edit or
  source conflict refuses it. Designs remain in the browser's IndexedDB.
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
design, writes a script, checks it on a copy and repairs it, then offers it or asks
a question. The user sees a preview and applies it as one undo step.

Building a whole piece from a sentence is a first-class request, alongside editing:
“build a stool” or “build a shelf that looks like this”. The reference can be a short
description or an attached picture. A new piece arrives in its own named folder
beside the existing design, using the folder scope of roadmap PRs 20 and 24.
When the request leaves sizes or joints open, the assistant asks for them or states
its proposed choices before building. Visual requests need the cut-aware drawings
of step 14 before the dock ships: dimensions and bounding boxes cannot judge a look.

The model uses the tools the MCP server already has: the guide, the examples and the
check. `editCad` already runs a script against a copy and leaves the design as it was
when the script fails, so the model sends its whole script again on each try and
nothing has to track a half-built candidate.

A [simulated chat](CAD_AI_FURNITURE.md#the-fifth-run-a-simulated-chat) on these tools
got six of nine requests right, most on the first check, and shaped the steps below:
step 9 and the comparison in step 8 come from it, and the views moved to the end.

```
Shared:  7 → 8
Chat:    9 → 13 → 10 → 11 → 14 → 12 (needs 7 and 8)
```

7. **Apply an outside document.** The open design takes a whole new document as one
   undo step, through the session's existing commit, and refuses it when the design
   has changed since the document was made. **Done when:** applying a script's result
   keeps the ID and geometry key of every part the script didn't change, and a hand
   edit made in between refuses the apply.
8. **Preview a candidate.** The studio shows a candidate over the open design, with
   the steps it adds, changes and removes, before anything is applied. It also says
   what the change costs: a cut-parts step that cut before and cuts nothing now, a
   joint that is gone, a warning that is new. A check can pass on a design that got
   worse. **Done when:** a candidate can be looked at from any side, then applied or
   dropped, and dropping it leaves no trace; and a candidate that sets a housing's
   depth to zero is shown as losing its housings.
9. **Change a design from a script.** Today a script adds to a design and can remove
   only a part's own cut. It needs to find a part, copy, cut, corner or step that is
   already there without making one, change a step's settings, and remove a part, a
   copy, a pattern, a cut-parts step or a variable. Asking for a part that isn't
   there is an error unless the script says the part is new. The guide gains a
   section on changing a design, and the report lists a pattern as one line with
   its count, not every copy. **Done when:** a script turns three of four housed
   shelves into loose ones by taking them out of the cut-parts step, and changes
   the depth of a cut that was typed as a number.
10. **Check a script in the browser.** The MCP server's `check_design`, run in an
    isolated frame that has no network and no storage: a design and a script go in, a
    design and a report come out. Scripts are plain JavaScript here, because the type
    check only runs under Node, so the API checks its own arguments: an option or a
    method it doesn't know is refused with the names it does. **Done when:** every
    example checks to the same report as on the command line, a script that tries to
    fetch or read storage fails, and a mistyped option name is reported with the
    right one.
11. **Connect a provider.** A key store of its own, which is never synced and never
    part of a settings backup. Two adapters: Anthropic, and OpenAI-compatible with an
    address that can be changed, which covers OpenAI, OpenRouter and most others. Each
    model says whether it can call tools, which the chat needs, and whether it can read images. Browser support for each provider is verified against its current documentation. **Done when:** the key
    appears in no synced setting, backup or log.
12. **The assistant dock.** Messages with image attachments, the selection as context, Stop, and a short log
    of what the model did ("floor 10 mm, wanted 12; made the pocket shallower"). The
    model ends a turn with a proposal or with a question, when the request and the
    design don't fit or the request can be read two ways. A proposal card lists what
    passed and what the change costs, opens the preview of step 8 and applies through
    step 7. What the user asked for earlier, such as "no visible screws", stays with
    the conversation and is sent with each request. A run stops after a set number
    of tries and says what it found. **Done when:** an end-to-end spec with a
    recorded model asks for a change, previews it, applies it and undoes it, and a
    hand edit made while the model works turns Apply off.
13. **Saved tasks.** Modelling tasks with their outcomes stated independently, run
    through the same loop without a browser, to compare models and to measure again
    after each API change. The nine requests of the simulated chat are the first. Include a stool, a shelf from a short description of its look, and a shelf from a picture, each with independently stated outcomes and human visual acceptance.
14. **Views in the report.** Top, front and right drawings of the boards as placed,
    with their cuts, and a section through a named cut, as SVG from the evaluated
    geometry. They are made in `cad-script`, so the command line and the MCP server
    get them too, and the browser turns them into images for models that read
    images. In the simulated chat, views of the boards as boxes caught no mistake the
    numbers hadn't. Views with actual cuts and outlines precede step 12 for visual requests; box-only views do not satisfy that requirement.

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
  writes can be saved to the Insert menu, which the isolation of step 10 makes safe.
  Without a folder scope, the simulated chat copied the cupboard script by hand into
  41 lines, with every name given a suffix.
- "A hole in the second shelf" needs a feature on one copy (roadmap PR 22), and a way
  to name that copy in a script. The simulated chat could only offer the hole in
  every shelf.
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

- The chat takes code and relies on step 10's isolation instead. Whether that frame
  works under the app's cross-origin isolation headers is untested; the batched JSON
  form is the way out if it doesn't.
- How well models write these scripts as plain JavaScript. None of the simulated
  chat's 24 checks failed the type check, but a mistyped option without it gives
  "Cannot read properties of undefined", which step 10's argument checks replace.
- Whether each provider accepts calls straight from a browser. The desktop build can
  make the call natively where one doesn't.
- Whether looking at drawings catches mistakes the numeric checks miss. It didn't in
  the simulated chat, with boxes only. A shaded picture or a second model as reviewer
  waits for a saved task that shows the need.
- A real conversation. The simulated chat gave each request to a model that saw only
  the design, ran each request once, and mostly used one model.
