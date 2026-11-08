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
the parts. See `examples/` for more.

## Writing a script

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
  `['board + 0.2mm', 'height/2']`, so joints follow the variables. Every vertex is placed,
  so the loop comes out fully constrained.
- `d.part(name, { relief: 'bit' })`, or `part.relief(...)`, puts dogbones in the part's
  inside corners for a bit of that diameter, so mortises and finger joints close. Corners
  on the outline of a pocket that runs off the part stay square. The check warns with
  `relief-bit` when the bit it plans with is wider than the relief.
- `pattern(items, { count, step: [dx, dy], rows? })` repeats curves, or a whole `rect` or
  `path`, in linked copies, such as a row of shelf-pin holes. Cutting the first copy's region cuts them all, including
  copies the pattern gains later. A count can be an expression, rounded down to say how
  many fit, and a step along one axis can be one too:
  `count: '(height - 2*margin)/pitch + 1', step: [0, 'pitch']`.
- `regionAt(x, y)` picks the innermost region at a point, as a click does. It only sees
  that sketch's own lines, so a profile hole doesn't split a region on `top`.
- `cut(region, { depth })` takes mm, or `'through'` for a hole. A through cut can't reach
  the part's edge: change the profile instead.
- `relate` takes `coincident`, `horizontal`, `vertical`, `parallel`, `perpendicular`,
  `equal`, `tangent`, `midpoint`, `symmetric` or `concentric`. Ends drawn at the same
  coordinates are already joined.
- `expect` checks `size`, `thickness`, `holes` (holes in the profile and through cuts
  from either face or a pocket floor, each pattern copy counted), `pockets` (cuts that aren't through,
  each pattern copy counted), `depths` (each cut's floor below its face, in feature
  order, pattern copies included) and `freedom`, within `tolerance` (0.01 mm). It doesn't
  check diameters or positions: read those from the report's cuts. Sizes are measured to
  where curves reach, not to the chords they're drawn with.
- Cuts on `sketchOn({ floorOf: cut })` start at that pocket's floor.
- `sketchOn('underside')` is drawn as the face is seen from below, so X runs the other way: a point at `x` on the part is at `-x` in the sketch. Its cuts come from a second side, after turning the board over: the toolpath summary lists them as `Side B: …`.
- Handles in the report, such as `7b8b`, work with `find` and `sketch` on that same
  revision of the design.
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
  `steps` with its width, length, depth and place. Parts have to be square to each other,
  and a tool has to be a plain block where it reaches in. Half-laps and finger joints
  aren't covered yet.
- `part.pattern({ axis: 'x', count: 'slats', spacing: '60mm' })` repeats a part in a row
  along a studio axis.
- `part.copy({ at, x, y, mirrored?, name? })` adds another of the part placed by hand. For
  a left and right pair that aren't alike, `mirrored: true` is the mirror image across the
  sketch's y axis. `name` gives it its own name, such as `'Right side'`. The report lists
  the pieces CAM cuts under each part's `pieces`.
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
