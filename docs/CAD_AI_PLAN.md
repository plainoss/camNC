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
- **A generated design only enters the app as a new job.** New part IDs change the
  key that identifies a physical sheet, so rerunning a script over a job would mark
  its sheets out of date.
- **No live editing yet.** The editor reads its document once and takes no outside
  changes, and designs live in the browser's IndexedDB, where no server can reach them.

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

[Designing furniture with scripts](CAD_AI_FURNITURE.md) lists what a furniture test run
found and what to improve next.

## Safety

No camNC-generated program has been cut yet, so:

- No agent tool runs outside demo mode, and none ships in production builds.
- `check` never writes a program, and a design that fails isn't written at all.
- Scripts state sizes and depths with `expect`.
- AI-authored programs stay uncut until the roadmap's test cut, then get an air cut first.

## Still unproven

Twelve pieces written by fresh agents from the README all passed, most within five
tries, but that's one model on tasks we chose. Measure again after each API change. The batched JSON form stays the fallback, and
any surface for an untrusted client should take data rather than code.
