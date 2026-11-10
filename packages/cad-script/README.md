# @wbcnc/cad-script

Build and edit designs from TypeScript, without the app. Used by coding agents and
tests. A script produces an ordinary CAD document and isn't kept. See
[the plan](../../docs/CAD_AI_PLAN.md) for why.

```ts
import { design } from '@wbcnc/cad-script';

export default design(d => {
  const plate = d.part('Plate', { thickness: 18 });
  plate.profile.rect({ at: [0, 0], w: 400, h: 300 });
  plate.profile.circle({ at: [30, 30], d: 8 });
  const top = plate.sketchOn('top');
  top.rect({ at: [100, 75], w: 200, h: 150 });
  plate.cut(top.regionAt(200, 150), { depth: 6 });
  plate.expect({ size: [400, 300], holes: 1, pockets: 1, depths: [6], freedom: 0 });
});
```

```sh
pnpm --silent --filter @wbcnc/cad-script check path/to/part.cad.ts --svg part.svg --out part.json
```

This type-checks the file, runs it, solves and prints a JSON report: errors, warnings,
each part's size, cuts, sketches with their free movement, what CAM received, and a
toolpath summary. Stdout is only the report; the solver's own messages go to stderr. It
exits non-zero if anything is wrong. Paths are relative to where you run it.

Options: `--from <document.json>` edits an existing design, or reports on it if no
script is given. `--out` writes the document, only if the check passed. Open that
file in camNC's CAM page to get it as a new job. `--svg` draws
the parts. A failed check removes any existing `--out` file and any existing `--svg`
file unless it writes a new SVG for that run. See `examples/` for more.

## The full report

```sh
pnpm --silent --filter @wbcnc/cad-script check --from design.json --report full
```

`--report full` prints everything the design is and makes, instead of the check report,
so a Part Studio or CAM change can be checked from a saved design in seconds, without
the app:

- `features`: the feature list in the studio's order (variables, planes, then each part's
  sketch, extrude, transform, face sketches, cuts, copies, patterns and cut-parts steps),
  each with its `settings` (thickness, end conditions such as up to a face, Add and
  Remove, the plane or face it's drawn on, depths as typed and as worked out, counts,
  clearances) and its `result`, or an `error` saying why it couldn't be made.
- `sketches`: each sketch's free movement and solver status (`solved`, `conflict`,
  `invalid`, or `shared` when it's solved where another step draws it), constraints by
  kind, geometry, and its regions as `r1`, `r2`, … from the bottom left. Steps name
  regions by these.
- `bodies`: each part as made: size, thickness, holes, cuts, the faces another part can
  be drawn on, what CAM received and its toolpath summary, planned alone.
- `assembly`: each placed part's box, and collisions.
- `boards`: every piece to cut, nested on boards fitted to them, one set per thickness,
  with pieces cut from both sides on boards turned over. Each board is planned together
  as the app plans one, with the default bit, settings and tabs: placements, how each
  piece is held, time, operations, CAM warnings and what would block the job.

The JSON is canonical: keys in a fixed order, numbers rounded to 0.001, and the only IDs
are the document's own, so the same design always prints the same text and a diff of
two reports shows what changed. With a script it reports on the design the script made;
the exit code still follows the check.

### Golden reports

`fixtures/designs/` holds saved designs, each with its full report next to it as
`<name>.report.json`. A test checks every design against its report:

```sh
pnpm --filter @wbcnc/cad-script exec vitest run designs
UPDATE_GOLDENS=1 pnpm --filter @wbcnc/cad-script exec vitest run designs   # rewrite them
```

To reproduce a bug from the app: save the design with Save to file (#351) in the design's top
bar, drop the `.json` in `fixtures/designs/`, run the update, and review the new report.
After a fix, run the update again and review the diff of the reports: it should change
only what the fix meant to. A design without a report fails with the command that makes
one. Scripts make designs for this folder too: `check examples/tray.cad.ts --out fixtures/designs/tray.json`.

## Complete Part Studio workflows

`pnpm --silent cad:iterate` from the repository root runs the cabinet edit sequence headlessly and writes named source checkpoints with a first-failure report. `pnpm --silent cad:iterate:ui` exercises the corresponding browser workflow. See [the iteration loop](../../docs/CAD_ITERATION.md) for commands, coverage and the agent procedure.

The package also exports `dividedTrayWorkflow()`, `fittedJointsWorkflow()` and `runCadWorkflow()` for complete eight-state source/material checks. Their [workflow contracts](src/iteration/WOODWORKING.md) describe independent recipe expectations, exact copy identities, actual cumulative source exports and explicit incomplete diagnostics. Command selection and complete interface scenarios are separate integrations.

## From an MCP client

Agents without a shell, such as Claude Desktop, use the same check through an MCP
server over stdio. It keeps designs in one folder: `<name>.cad.ts` is the script,
`<name>.json` the document to open in camNC's CAM page, written only when the check
passes, and `<name>.svg` the drawing.

```sh
pnpm --silent --dir <camNC checkout> --filter @wbcnc/cad-script mcp --dir ~/designs
```

Use that as the server's command, for example in Claude Desktop's
`claude_desktop_config.json` under `mcpServers`, or with
`claude mcp add camnc-cad -- pnpm --silent --dir <camNC checkout> --filter @wbcnc/cad-script mcp --dir ~/designs`.
An app that starts it without your shell's `PATH` needs the full path to `pnpm`.
Its tools: `cad_script_guide` (this file and the list of examples),
`cad_script_example`, `check_design` (save a script under a name, check it, and get the
report) and `read_design`.

## Writing a script

A design is for people to keep working on in the app, as they would a Part Studio:
change a variable or a dimension, or a step's settings. So:

- Name every size a person would change as a variable, and write lengths from them.
- Prefer a feature over geometry drawn to look like one: `rect` over a four-point path,
  `pattern` and `copy` over repeated parts, `cutParts` over openings drawn into the
  part that receives them, `split` over hand-drawn laps and fingers, and `relief` over
  hand-drawn dogbones.
- Draw a custom outline with `path` only when it is one, such as a leg with a tenon.

- All lengths are mm, Y up, in the part's own sketch coordinates. Arc angles are degrees.
- `rect`, `circle` and `polygon` come dimensioned and placed, so they're fully
  constrained. `line` and `arc` come free, for you to constrain with `relate`,
  `distance` and `place`.
- The profile's outer loop is the part's shape, and inner loops are through-holes
  unless a cut gives them a depth.
- Use `rect` for a rectangle: it's dimensioned by width and height, which is what a person
  edits later. `polygon` pins each vertex by its position, so `freedom: 0` doesn't make
  it regular. Both return `corners`, in vertex order, and `fillet(corners, r)` rounds
  them in any sketch. The radius can be an expression.
- `path([x, y]).lineTo([x, y]).arcTo([x, y], { r }).close()` draws any outline of lines
  and arcs. An arc with `r` turns counterclockwise unless `clockwise`, the short way
  round unless `large`. One with `tangent: true` carries on smoothly from the segment
  before it, which makes slots and wavy edges. Vertices can be expressions, such as
  `['board + 0.2mm', 'height/2']`, so joints follow the variables. The loop comes out
  fully constrained and dimensioned as a person would draw it: the start is placed, each
  edge along an axis is horizontal or vertical with its length, such as `board` for a
  tenon worked out from `legH` and `legH + board`, and every other corner is measured
  from the one before. Changing one length in the app moves what comes after it.
  `close()` warns with `close-straight` if it adds a line; use `close({ straight: true })` when intended.
- `d.part(name, { relief: 'bit' })`, or `part.relief(...)`, puts dogbones in the part's
  inside corners for a bit of that diameter, so mortises and finger joints close. Corners
  on the outline of a pocket that runs off the part stay square. The check warns with
  `relief-bit` when the bit it plans with is wider than the relief. The report gives a
  cut's size as drawn, and its size with the bones as `relieved` when they make it wider.
- `pattern(items, { count, step: [dx, dy], rows? })` repeats curves, or a whole `rect` or
  `path`, in linked copies, such as a row of shelf-pin holes. Cutting the first copy's region cuts them all, including
  copies the pattern gains later. `pattern-copies-missing` warns with the pattern handle
  and missing count when overlapping geometry changes copy regions. A count can be an
  expression, rounded down to say how many fit, and a step along one axis can be one too:
  `count: '(height - 2*margin)/pitch + 1', step: [0, 'pitch']`.
- `regionAt(x, y)` picks the innermost region at a point, as a click does. It only sees
  that sketch's own lines, so a profile hole doesn't split a region on `top`.
- `cut(region, { depth })` takes mm, or `'through'` for a hole. A through cut can't reach
  the part's edge: change the profile instead.
- `relate` takes `coincident`, `horizontal`, `vertical`, `parallel`, `perpendicular`,
  `equal`, `tangent`, `midpoint`, `symmetric` or `concentric`. Ends drawn at the same
  coordinates are already joined.
- `expect` checks `size`, `thickness`, `holes` (holes in the profile and through cuts
  from either face or a pocket floor, each pattern copy counted), `notches` (through cuts
  touching or crossing the part outline, drawn separately in SVG), `pockets` (cuts that aren't through,
  each pattern copy counted), `depths` (each cut's floor below its face, in feature
  order, pattern copies included) and `freedom`, within `tolerance` (0.01 mm). It doesn't
  check diameters or positions: read those from the report's cuts. `size`, `thickness` and
  `depths` also take expressions evaluated with the design variables; invalid expressions
  fail the check. Sizes are measured to where curves reach, not to the chords they're drawn with.
- Cuts on `sketchOn({ floorOf: cut })` start at that pocket's floor.
- `sketchOn('underside')` is drawn as the face is seen from below, so X runs the other way: a point at `x` on the part is at `-x` in the sketch. Its cuts come from a second side, after turning the board over: the toolpath summary lists them as `Side B: …`.
- Handles in the report, such as `7b8b`, work with `find` and `sketch` on that same
  revision of the design. `redundant-constraint` names the involved entity handles.
- A script that stops with an error leaves the design as it was.

## Variables

- `d.variable('board', '18mm')` adds a design variable, or changes the one with that
  name. A length can then be an expression: `w: 'width - 2*board'`, `thickness: 'board'`.
  The expression is saved, so the part keeps following the variable when someone changes
  it in the app. A plain number next to a variable takes that variable's unit:
  `'depth + 10'` is mm.
- Cut depths (`{ depth: 'board/2' }`), offsets, clearances, pattern counts and positions
  follow variables too. `d.value('board + margin')` works an expression out now, for a
  script's own loops. A count or ratio without units, such as
  `d.value('(height - 160)/pitch')`, comes back as a plain number.
- Expressions can call `floor`, `round`, `min`, `max` and `sqrt`: `'floor(width/40)'`
  fingers, `'min(depth; 600mm)'`, `'sqrt(w*w + h*h)'` for a diagonal. Separate `min` and
  `max` arguments with `;` or `, `. A cut whose depth works out to zero or less stops the
  script.

## Building a piece in the studio

See `examples/cupboard.cad.ts`. The studio's X runs left to right, Y front to back and Z
up. Build a piece the way it goes together: each part drawn where it sits, and joints cut
by the parts that fit them.

- `part.drawOn('top' | 'front' | 'right', { offset })` draws a part on a base plane. The
  top plane's sketch x and y are X and Y; the front plane's are X and Z, looking -y; the
  right plane's are Y and Z, looking +x. The thickness grows along the plane's normal, or
  the other way with `inward: true`, and `offset` moves the part along that normal.
- `part.drawOn(other.face('+x'), { offset })` draws it on another part's face, so it moves
  with that part. `face` takes `'top'`, `'underside'`, or the direction an edge face looks
  in the studio. If no face looks that way, the error lists the ones there are.
- The report's `steps` say where each face is in words: "Side's top (+x): sketch origin
  at 18, 0, 0, its x along +y, its y along +z, looking +x." Read them to check a part
  sits where you meant before reading anything else.
- `d.cutParts(target, { with: [tools], clearance: 'fit' })` cuts the tools out of the
  target wherever they reach in: rebates, dados, grooves and mortises that follow both
  parts. The clearance grows every side of an opening inside the target and deepens a
  blind one; sides that run off the target's edge stay open. Each opening is listed in
  `steps` with its width, length, depth and place. Parts have to be square to each other.
  Where a tool reaches in it has to be made of square-cornered, straight-sided blocks: a
  shouldered tenon cuts only its tenon, and a comb of fingers cuts one slot per finger
  into a plain board. A tool with `relief` has bones on its own shoulders, so it can't
  cut.
- `d.cutParts(a, { with: b, split: 'half' })` makes a half-lap where two parts cross,
  each losing half its height, and `split: { fingers: 5 }` a finger joint at a corner.
  Both parts are kept. A strip sketched on a board's face and extruded across it can
  make the other board: fingers follow the longer in-plane overlap, and cuts stop
  at the overlap depth so the extruded board keeps its backbone.
  The finger count also accepts an expression, such as `split: { fingers: 'n' }`, and follows its variables.
  Draw both parts as plain boards: the step makes the slots, so a person changes the
  joint by its finger count, and the slots follow the boards' sizes.
- `part.pattern({ axis: 'x', count: 'slats', spacing: '60mm' })` repeats a part in a row
  along a studio axis.
- `part.copy({ at, x, y, mirrored?, name? })` adds another of the part placed by hand. For
  a left and right pair that aren't alike, `mirrored: true` is the mirror image across the
  sketch's y axis. `name` gives it its own name, such as `'Right side'`. The report lists
  the pieces CAM cuts under each part's `pieces`.
- `copy()` returns that copy, and `pattern()` its copies (the part itself not among
  them), each with its `name`. A copy can be a `cutParts` tool on its own: with three
  shelves, `d.cutParts(side, { with: copies[0] })` houses only the middle one. With the
  part itself as the tool, the part and every copy cut.
- `part.place({ at, x: '+y', y: '+z' })` places a part by hand when it isn't drawn on a
  plane or face.
- The report's `assembly` lists each part's box, and an error `parts-collide` says where
  two parts need the same material. Openings count as empty.

## The toolpath summary

Each part is planned alone on a board the way the app plans it, with the default 3.175 mm
bit and settings and tabs holding it: its operations, time, CAM warnings, and anything
that would block the job. CAM's own warnings, such as material left in corners, stay in
each part's `toolpaths.warnings`. Only a blocked job, or a cut no tool fits, adds a
top-level warning. Pass `{ toolpaths: false }` to `inspectCadDocument` to skip it.

## What the report doesn't cover

It never writes or prints G-code, and it doesn't say a program is safe to run. The app
plans again with your bit, material and board, and that's the program that runs.
