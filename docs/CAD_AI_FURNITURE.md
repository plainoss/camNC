# Designing furniture with scripts

What [`@wbcnc/cad-script`](../packages/cad-script/README.md) can build today, where real
furniture still runs into limits, and what to improve next. This is based on thirteen
pieces scripted on 2026-11-08. Fresh agents wrote twelve of them from the README and
examples alone. The cupboard is the reference example in
`packages/cad-script/examples/cupboard.cad.ts`.

## The test set

| Piece                                         |  Parts | Result    | Notes                                                                         |
| --------------------------------------------- | -----: | --------- | ----------------------------------------------------------------------------- |
| Phone stand side, drawer front, coaster       | 1 each | First try | Imported into the app: sketch, 3D and planned operations matched the report   |
| Bookshelf: dados, back rebates, back          |      7 | 2 tries   | Rebates and dados drawn past the part so they run off the edge                |
| Kitchen cabinet on a 32 mm system             |      7 | 2 tries   | Hand-mirrored sides came out with 28 and 32 pin holes, and nothing noticed    |
| Nightstand with drawer box and finger joints  |     15 | 5 tries   | Dogbones folded into the outline by hand; dowel holes moved off the underside |
| Wardrobe door with panel, pull and hinge cups |      1 | First try | Cups on the back, so the report has no toolpaths for it                       |
| Plant stand with cross-lap legs               |      3 | 5 tries   | Clearance (+0.2 mm) shared as a constant, not tied to the other part          |
| Stool with wedged through tenons              |     11 | First try | Dogbones from a 120-line helper the agent wrote                               |
| Wall shelf with keyholes and brackets         |      4 | 4 tries   | Undercut impossible; chamfer faked as two steps                               |
| Desk organizer with half-laps                 |      7 | 3 tries   | 12 mm pen holes in 9 mm stock became a two-layer base                         |
| Coat rack with wavy edges and counterbores    |      1 | 4 tries   | CAM dropped both counterbores while the check passed. Now a warning           |
| Cupboard with variables, placement and pins   |      6 | Reference | Rebuilt 900 wide from 19 mm board, and changed in the app: holds              |

Every piece ended fully constrained and passing. In under 300 lines each, a model can
describe real joinery: dados, rebates, cross-laps, through tenons, finger joints,
shelf-pin rows, hinge cups and keyholes. The friction is in what a woodworker means
that the model can't say, and in what CAM does with it.

## What works now

- **Parts and cuts.** Profiles with holes, pockets on the top, the underside or a
  pocket's floor, through cuts, and fillets. Every value is dimensioned, so sketches
  come out fully constrained.
- **Variables.** `d.variable('board', '18mm')`, then sizes, positions, thicknesses,
  cut depths and placements written as `'width - 2*board'`. They're saved as the model's
  expressions. Changing `width`, `board` and `housing` together in a saved cupboard
  resizes, moves and re-cuts everything with no clashes.
- **Assembly.** `part.place` stands a part up by naming where its axes point. The
  model's collision check, used by the report and the app's Assembly view, flags two
  parts needing the same material, with rebates and dados counted as empty. A shelf
  1 mm into a side shows up with its exact overlap.
- **Paths.** Outlines of lines and arcs, with tangent arcs for slots and wavy edges,
  fully constrained without hand-written relations.
- **Patterns.** Linked rows of holes, such as 32 mm shelf pins. Their count and pitch
  can follow variables, and one cut on the first hole cuts every copy, so a taller
  cupboard gets more pins, all cut.
- **Copies.** One part and its copies, plain or mirrored, placed independently and cut
  as CAM counts them. The cupboard's right side is a mirrored copy of the left, which
  rules out the drift the hand-mirrored cabinet sides showed.
- **Checks.** Types, the solver, feature rules, `expect` for sizes, holes, pockets and
  depths, and a toolpath summary per part. The summary has the operations, time, CAM
  warnings, blocked jobs and cuts no tool fits. A part with cuts on its back is planned
  on both sides, with the same side B features the app uses.
- **Into the app.** The checked `.json` opens as a new job with its variables, parts and
  placements.

## Where it falls short

Grouped by where the fix belongs.

### The design model (`packages/cad`)

1. **No joints or fits.** A dado's width only follows the shelf because both name
   `board`. A slot can't say "the other part's thickness plus 0.2 mm".
2. **No inside-corner relief.** Dogbones and T-bones are hand-drawn arcs. Every
   flat-pack piece needed them, and they made up most of its code.
3. **No edge features.** Holes into an edge, round-overs and chamfers can't be recorded,
   even as notes.
4. **One bad cut breaks every part.** When one part fails to solve, the others report
   "no outline" too.

### CAM (`packages/cam`)

1. **No drilling.** Pin holes, dowel holes and hinge cups are milled as pockets with the
   3.175 mm bit.
2. **A hole inside a counterbore is treated as an island,** so a narrow counterbore gets
   no tool at all.
3. **Warnings give heights from the board's bottom** ("z=12" for a 6 mm pocket), and
   corner warnings don't say where.
4. **Outline inside corners** in finger joints and notches get no warning, though a
   round bit leaves them rounded.

Rebates and grooves drawn past the part used to warn about material "left in corners".
That material was in the waste past the edge, not on the part: CAM already runs open
pockets out of the edge. The warning now counts only the part.

### cad-script

1. **The drawing is for reading only.** Labels can still crowd on dense parts.

## Next, in order

1. **Inside-corner relief** as an option on rectangles, polygons and outlines, sized
   from the bit, with a CAM warning for outline corners left round.
2. **Joints and fits** (roadmap PR 10). The assembly check is ready to confirm them.
3. **Drilling operations** for holes up to the bit's size and for hinge cups.
4. **A second furniture run** with the path builder, copies and variables, to measure
   the change in tries and lines.

Results from that second run belong in this file.
