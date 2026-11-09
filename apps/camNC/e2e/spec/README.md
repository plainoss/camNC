# Behaviour specs

These specs state how the tool should behave as data, so they survive a rewrite of
the code they test. A scenario only says what a person does and what must then be
true. Nothing in `scenarios/` names a React component, CSS class or internal ID.

```text
scenarios/<domain>/*.json   what a person does and what must be true
adapters/<domain>.mjs       the only app-specific code: drive input, read state
adapters/sketch.headless.mjs  the same steps against the editor's code in Node, for the scenarios it models
goldens/<domain>/*.svg      reviewed pictures of named moments, normalized
run.mjs                     runner, matchers and golden comparison
```

To rewrite the app, replace the adapter. To add behaviour, add a scenario.

## Run

This starts its own dev server, because the adapter reads the saved design from the
running app. CI runs the same command.

```sh
pnpm --filter @wbcnc/camNC spec:cad
```

Options: `--url <running dev server>`, `--only <id prefix>`, `--headed`, `--list`, `--update-goldens`, `--workers <n>`.

Scenarios run 4 at a time, each in its own browser context, so they share no saved state. Use `--workers 1` to rule out
load when debugging a failure. Goldens are always rewritten one at a time.

Results are one of `PASS`, `FAIL`, `XFAIL` (a listed known gap still fails) and
`XPASS` (a known gap now passes, so remove its `known` field). The run fails on
`FAIL` and `XPASS`, so a fix can't go unrecorded and a known gap can't be forgotten.

A scenario with a `flaky` field (the issue that tracks it) is quarantined: it still runs, but a failure is reported as
`FLAKY` and doesn't fail the run. Use it only for a race that blocks other PRs while its issue is open, and remove
the field with the fix.

## Without a browser

`headless.test.mjs` runs the sketch scenarios that need no page against the editor's own drawing code in Node, through
`adapters/sketch.headless.mjs`. It is part of the app's domain tests, so it takes milliseconds and runs on every change:

```sh
pnpm --filter @wbcnc/camNC exec vitest run --config vitest.node.config.ts e2e/spec/headless.test.mjs
```

It picks a scenario only when it models every step and expectation in it. So far that is the corner and center
rectangle tools (`key g`, `key r`, `rect`, clicks and drags) and the geometry, `regions` and `tool` expectations.
Anything else, and every `frame`, stays browser-only. The browser run still runs every scenario, so both adapters must
agree on the ones they share. A tool runs here once its logic lives in `@wbcnc/cad-editor`, and
`@wbcnc/cad-editor/headlessSketch` drives it.

## Interactive session

A session keeps one page open and takes scenario steps a line at a time, so an agent
or developer can try a feature and read the result without replaying from the start.
It uses the same adapter, so everything is real input in demo mode, and it only
accepts a local server. Each line returns one JSON object with `ok`, the state after
the step, any new page errors and `ms`.

```sh
# A pipe. The exit code is non-zero if any line failed.
printf 'rect 10,10 100,60\nexpect {"entityCount":4}\n' | pnpm --silent --filter @wbcnc/camNC spec:session

# Long-lived, for callers that can't hold stdin open. Stops on `quit` or after 30 idle minutes.
pnpm --silent --filter @wbcnc/camNC spec:session --listen
pnpm --silent --filter @wbcnc/camNC spec:session send 'rect 10,10 100,60' 'key d' 'frame after-dim'
```

Options: `--listen`, `--url <running dev server>`, `--headed`. Each checkout runs one
listening session.

Besides the steps below, a line can be:

| Line             | Meaning                                                              |
| ---------------- | -------------------------------------------------------------------- |
| `state`          | The state now, without doing anything                                |
| `expect <json>`  | Check any expectation from a scenario; failures fail the line        |
| `frame [name]`   | Write the normalized SVG to `apps/camNC/test-results/spec-session/`  |
| `shot [name]`    | Write a screenshot to the same folder                                |
| `render [views]` | Show each named view of the Part Studio and write `<view>.png` there |
| `reset`          | Start again on a fresh page with nothing saved                       |
| `quit`           | Stop                                                                 |

Once a behaviour works, write the steps that showed it as a scenario.

## Reproducing from a saved design

**Save to file** in a design's top bar writes the whole design (every part's features, sketches, dimensions,
variables and planes) as `.json`. To reproduce a report from one, put the file in `designs/` and start from it:

```sh
printf 'open designs/plate.json\nstate\n' | pnpm --silent --filter @wbcnc/camNC spec:session
```

A scenario does the same with `"open designs/<name>.json"` as its first step. Outside the editor,
`pnpm --filter @wbcnc/cad-script check --from <file.json>` loads it headless, and a unit test can read it with
`parseCadDocument(JSON.parse(text))` and render `<CadEditor document={…} />`.

## Rendering a saved design

To look at a design's result without driving the editor, render it. This starts its own dev server, opens the file
the way `open` does, shows each named view of the Part Studio's 3D view with its keyboard shortcut and writes one PNG
per view at a fixed viewport and a device scale of 1:

```sh
pnpm --silent --filter @wbcnc/camNC render designs/plate.json --view top --view iso
# {"ok":true,"files":[".../test-results/spec-render/plate/top.png",".../iso.png"],"parts":1,"errors":[],"ms":41614}
```

Options: `--view <front|back|left|right|top|bottom|iso>` (repeat, or separate with commas; `iso` by default),
`--out <dir>` (default `apps/camNC/test-results/spec-render/<design>/`), `--size <W>x<H>` (default `1440x1000`),
`--planes` (keep the origin and base planes, which are hidden by default so the view frames the parts),
`--url <running dev server>`, `--headed`. The design path is read from where the command was typed, else from this
folder. It prints one JSON line with the files, the design's part count, any page errors and `ms`, and exits non-zero
if anything failed, including a page or console error (as in a behaviour spec; its pictures are still written). A picture is written once two frames in a row of the 3D view look the same, so the camera has
moved and been drawn. In a session, `render top iso` does the same on the open design.

`pnpm --filter @wbcnc/camNC test:render` checks the command end to end on `designs/plate.json`. It starts a dev
server and a browser, so it isn't part of `pnpm test`; CI runs it in the behaviour-spec job.

## Scenario format

```json
{
  "id": "sketch/dimension/point-line-normal",
  "title": "A point and a diagonal line dimension as their perpendicular distance",
  "evidence": "reference-live 2026-11-06",
  "known": "optional: why this still fails, removed once it passes",
  "flaky": "optional: the issue of a quarantined race, removed with its fix",
  "steps": ["line 20,10 120,70", "key d", { "expect": { "tool": "dimension" } }]
}
```

All coordinates are sketch millimetres with Y up, never pixels. `evidence` says why
this is the desired behaviour: `reference-live <date>`, `reference-report <name>`,
`reference-docs <page>`, `manu <date>` or `design <reason>`. A scenario with no real
reference should say `design`, so nobody later mistakes it for reference CAD behaviour.
The comparison reports themselves are kept outside this repository.

### Steps

| Step                                                                                     | Meaning                                                                                         |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `key <key>`                                                                              | Press a key or chord, such as `key Shift+a`                                                     |
| `type <text>`                                                                            | Type characters at the current focus                                                            |
| `click x,y` / `dblclick x,y` / `shiftclick x,y` / `rclick x,y`                           | Pointer press and release with real movement                                                    |
| `hover x,y`                                                                              | Move there without pressing                                                                     |
| `down x,y` / `move x,y` / `up`                                                           | One gesture in parts, for checks made mid-gesture                                               |
| `drag x,y x,y`                                                                           | Press, move in steps, release                                                                   |
| `wheel x,y <delta>`                                                                      | Scroll at a position                                                                            |
| `tool <name>`                                                                            | Choose a tool that has no shortcut, by its visible name                                         |
| `line x,y x,y` / `rect x,y x,y` / `circle x,y r` / `arc x,y x,y x,y`                     | Draw with the normal tool, then leave it                                                        |
| `field <label> <value>`                                                                  | Fill a labelled field and press Enter                                                           |
| `finish` / `cancel` / `design` / `goto <stage>`                                          | Accept the design (closing the sketch first), leave it, return to Design, or click a stage link |
| `closesketch`                                                                            | Close the open sketch back to the Part Studio with its dialog's tick                            |
| `uncheck <label>` / `hold <key>` / `release <key>` / `selectdim` / `editdim` / `addpart` | Hold a modifier, select or edit the first dimension label, add a part                           |
| `handle <start\|end> <point\|segment> [add]`                                             | Click a spline's own tangent handle, optionally adding to the selection                         |
| `open <file.json>`                                                                       | Open a saved design file (relative to this folder) as a new project, on its first sketch        |
| `hideplanes`                                                                             | Hide the origin and base planes with their eyes in the feature list                             |
| `view <name>`                                                                            | Show the Part Studio's 3D view from `front`, `back`, `left`, `right`, `top`, `bottom` or `iso`  |
| `frame <name>`                                                                           | Compare this moment with a reviewed golden, if one exists                                       |
| `{ "expect": { ... } }`                                                                  | Check the state at this moment                                                                  |

### Expectations

Geometry: `entities`, `entitiesInclude`, `entityCount`, `acceptedEntityCount`, `regions`.
Dimensions and relations: `dimensions`, `dimensionsInclude`, `constraintsAtLeast`,
`labelText`. Interface: `tool`, `status`, `readout`, `pageText`, `focus`, `canFinish`, `canUndo`,
`canRedo`, `stage`, `cursor`. Appearance: `previewCount`, `strokePx`, `colors`,
`annotation`. See `adapters/sketch.mjs` for exact meanings and default tolerances.

## Goldens

A golden is a normalized SVG of the canvas at a `frame`: screen pixels at a fixed
viewport, effective stroke widths and colours written out, no names or IDs. Constraint
glyphs are left out until their placement is deterministic between runs. Open one in
a browser to review it. Comparison allows 2 px of drift, so ordinary numeric noise
doesn't fail but a floating label or a thick preview does.

Goldens change only through `--update-goldens`, and that diff must be reviewed like
code. Prefer an `expect` where a fact can be stated; use a golden for what only a
picture can pin down. Don't capture a golden from behaviour known to be wrong.

## Adding domains

`domain` comes from the scenario ID, so `part/...` loads `adapters/part.mjs`. Features
such as extrude, pockets, mirrored parts, patterns and assemblies get their own folder
and adapter, reusing this runner, its step grammar and its result rules. A new domain
adds its own steps and canonical state (for example bodies, faces, mates) through its
adapter's `step` and `check` functions.
