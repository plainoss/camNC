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
toolpath summary. It
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
  them in any sketch.
- There's no pattern helper yet: repeat a shape in a loop.
- `regionAt(x, y)` picks the innermost region at a point, as a click does. It only sees
  that sketch's own lines, so a profile hole doesn't split a region on `top`.
- `expect` checks `size`, `thickness`, `holes`, `pockets`, `depths` (each cut's floor
  below its face, in feature order) and `freedom`, within `tolerance` (0.01 mm). It
  doesn't check diameters or positions: read those from the report's cuts.
- Cuts on `sketchOn({ floorOf: cut })` start at that pocket's floor.
- `sketchOn('underside')` is drawn as the face is seen from below, so X runs the other way: a point at `x` on the part is at `-x` in the sketch. Its cuts come from a second side, which the report doesn't cover.
- Handles in the report, such as `7b8b`, work with `find` and `sketch` on that same
  revision of the design.
- A script that stops with an error leaves the design as it was.

## The toolpath summary

Each part is planned alone on a board the way the app plans it, with the default 3.175 mm
bit and settings and tabs holding it: its operations, time, CAM warnings, and anything
that would block the job. CAM's own warnings, such as material left in corners, stay in
each part's `toolpaths.warnings`. Only a blocked job adds a top-level warning. Pass `{ toolpaths: false }` to `inspectCadDocument` to skip it.

## What the report doesn't cover

It never writes or prints G-code, and it doesn't say a program is safe to run. The app
plans again with your bit, material and board, and that's the program that runs.
