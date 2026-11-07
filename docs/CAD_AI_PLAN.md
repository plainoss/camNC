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
5. After the physical test cut and roadmap PRs 8–10: variables, placements and joints
   in the API, then decide on an MCP server and in-app chat. Both need the editor to
   accept outside changes through its session.

Step 5 can't start yet: it needs the physical test cut, and variables, placements and
joints (roadmap PRs 8–10) to exist before the API can describe them.

## Safety

No camNC-generated program has been cut yet, so:

- No agent tool runs outside demo mode, and none ships in production builds.
- `check` never writes a program, and a design that fails isn't written at all.
- Scripts state sizes and depths with `expect`.
- AI-authored programs stay uncut until the roadmap's test cut, then get an air cut first.

## Still unproven

How reliably models write working scripts hasn't been measured. Try the API on real
tasks with a model before adding to it. The batched JSON form stays the fallback, and
any surface for an untrusted client should take data rather than code.
