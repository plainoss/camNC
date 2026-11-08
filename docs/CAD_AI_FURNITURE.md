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

## The second run

On the same day, fresh agents built the nine larger pieces again from the updated
README. This time each piece also had to hold its sizes in variables, place every part
in an assembly, use copies for repeated parts, and clear the collision check.

| Piece           | Lines, first run | Lines, second run | Check runs, first → second |
| --------------- | ---------------: | ----------------: | -------------------------- |
| Bookshelf       |               73 |                61 | 2 → 3                      |
| Kitchen cabinet |              112 |               119 | 2 → 3                      |
| Nightstand      |              241 |               201 | 5 → 4                      |
| Wardrobe door   |               62 |                63 | 1 → 1                      |
| Plant stand     |              112 |               125 | 5 → 2                      |
| Stool           |              238 |               195 | 1 → 1                      |
| Wall shelf      |              237 |               160 | 4 → 2                      |
| Desk organizer  |              244 |               217 | 3 → 2                      |
| Coat rack       |              181 |                84 | 4 → 3                      |
| **Total**       |        **1,500** |         **1,225** | **27 → 21**                |

All nine passed with no collisions, and the 55 placed parts make whole pieces of
furniture. Paths shortened the curved pieces the most: the coat rack's wavy board went
from 181 lines to 84. What still took code was corner relief, written as a 40–45 line
helper in each flat-pack file. Corner relief has since become a part option.

### Where one part had to follow another

Every joint was kept in step by hand, through shared variables or one function drawing
both sides:

- **A cut as wide as another part's thickness, plus clearance:** dados for shelves,
  cross-lap slots, divider dados, runner grooves, bracket dados.
- **A cut where another part sits:** shelves at the dado positions, seat mortises under
  the leg tenons, stretcher mortises at the stretcher's height.
- **Shapes that fit into each other:** finger joints, half-laps, mortises and tenons.

Only the plant stand wrote these as expressions, so only its joints still fit after
changing the board thickness. The others baked numbers in. That points at sketching a
cut on the face of the part it receives, offset by a clearance, which is what the planned
Part Studio is built around.

### Fixed after the second run

In #222, #223 and #224:

- Half circles with a radius, and S-curves whose halves share a center, now come out
  fully constrained with no repeated constraints.
- Sizes are measured to where curves reach, not to their chords: the coat rack is
  900 long, not 899.98.
- The check's stdout is only the report; the solver's messages go to stderr.
- Fillet radii take expressions, `d.value` returns counts, and `pattern` takes a whole
  rectangle or path.
- A pattern of a groove that runs off the part now cuts every copy.
- CAM cuts a counterbore barely wider than its screw hole, using the hole's space.

## The third run, in the Part Studio

Fresh agents built the same nine pieces again from the README, now drawing each part on a
plane or another part's face and cutting joints with `cutParts`. They then changed each
piece's board thickness and checked that the joints still fit.

| Piece           |   Lines, runs 1 / 2 / 3 | Check runs, run 3 |
| --------------- | ----------------------: | ----------------: |
| Bookshelf       |            73 / 61 / 56 |                 1 |
| Kitchen cabinet |         112 / 119 / 106 |                 3 |
| Nightstand      |         241 / 201 / 178 |                 1 |
| Wardrobe door   |            62 / 63 / 62 |                 2 |
| Plant stand     |          112 / 125 / 55 |                 6 |
| Stool           |         238 / 195 / 169 |                 5 |
| Wall shelf      |          237 / 160 / 90 |                 2 |
| Desk organizer  |         244 / 217 / 123 |                 2 |
| Coat rack       |           181 / 84 / 82 |                 3 |
| **Total**       | **1,500 / 1,225 / 921** |            **25** |

All nine passed with no collisions, and the joints of all nine still fit after the
thickness change, against one of nine in the second run. Housings, dados, rebates and
grooves cut by the parts that fit them followed on their own. The rest followed because
the agents wrote them as expressions.

What still took hand work, or went wrong:

- **Faces after `inward`.** A door drawn `inward` on the front plane still has its `top`
  at the sketch plane, its show face. The agent put the hinge cups there and every check
  passed. Picking the face to sketch on by direction would have caught it.
- **Laps and fingers.** Cross-laps, half-laps and box joints were drawn into outlines by
  hand, and a finger count can't follow a variable.
- **Shouldered tenons.** `cutParts` refuses a tool that isn't a plain block where it
  reaches in, so every mortise for a shouldered tenon was drawn by hand. The step then
  warns that it cuts nothing while the same report shows the collisions.
- **Copies.** `copy()` returns nothing to use as a tool, and a plain copy of a housed side
  carried its housing on the outer face until it was made a mirrored copy.
- **Expressions.** No `floor`, `sqrt` or squared lengths. A cut whose depth reaches zero
  after a change disappears silently.
- **Report.** Cut sizes include the dogbones (15.93 for a 15 mm dado), underside circles
  measure 34.99, and through cuts drawn in a sketch don't count under `holes`.

## The fourth run, with joints cut by parts

Two fresh agents built the nine pieces again from the README, now with copies as tools,
combs and shouldered tenons cut by `cutParts`, and `floor`, `min`, `max` and `sqrt` in
expressions. Then they changed each piece's board thickness.

| Piece           |     Lines, runs 1 / 2 / 3 / 4 | Check runs, run 3 / 4 |
| --------------- | ----------------------------: | --------------------: |
| Bookshelf       |             73 / 61 / 56 / 47 |                 1 / 1 |
| Kitchen cabinet |          112 / 119 / 106 / 92 |                 3 / 2 |
| Nightstand      |         241 / 201 / 178 / 130 |                 1 / 2 |
| Wardrobe door   |             62 / 63 / 62 / 59 |                 2 / 1 |
| Plant stand     |           112 / 125 / 55 / 68 |                 6 / 1 |
| Stool           |         238 / 195 / 169 / 170 |                 5 / 6 |
| Wall shelf      |           237 / 160 / 90 / 86 |                 2 / 5 |
| Desk organizer  |         244 / 217 / 123 / 124 |                 2 / 4 |
| Coat rack       |            181 / 84 / 82 / 77 |                 3 / 3 |
| **Total**       | **1,500 / 1,225 / 921 / 853** |           **25 / 25** |

All nine passed with no collisions. After the thickness change every joint still fit,
with no collisions. Two checks failed only on the agent's own `expect` depths, written
as fixed numbers. The bookshelf's shelves are one part patterned up, and the nightstand's
housings come from one side cutting both its copies.

What still took hand work, or went wrong:

- **Box joints.** A comb cuts slots into a plain board. When both boards have fingers,
  each is refused as not "square-cornered and straight-sided", so the drawer's corners
  were drawn as finger outlines from shared expressions.
- **Relief on a tool.** With `relief`, a part's tenon shoulders get bones, and it can't
  cut its mortise any more. The stool's seat mortises and wedge holes were drawn by hand.
- **Relief and round holes.** The cabinet's 36 pin holes were counted as "640 corners …
  too tight for a 3.175 mm bone". CAM still warned about material left in the bones'
  corners, so it was unclear whether the bones helped.
- **Half-laps and cross-laps** are still slots drawn into outlines.
- **Units in counts.** `(width/3 - 3*board/2 - 10mm)/penPitch` was refused as having
  units until `30mm` became `30` elsewhere in it.
- **`expect` takes numbers only,** so depths that follow a variable fail the check when
  it changes.
- **Report.** A notch off a part's edge counts under `holes`. `corner-relief-skipped` and
  `redundant-constraint` name no corners or entities. Pattern copies swallowed by an
  overlapping shape vanish without a word, and `close()` adds a straight edge silently.
  The face frames don't say which face of a part is its `top`.
- **Docs.** The README still said finger joints aren't covered. Argument types for
  `relief`, `clearance` and `copy`'s axes had to be guessed from the examples.

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
- **Corner relief.** A part option puts dogbones in its inside corners for a given bit,
  and the summary warns when the bit cutting it is wider.
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
2. **No edge features.** Holes into an edge, round-overs and chamfers can't be recorded,
   even as notes.
3. **One bad cut breaks every part.** When one part fails to solve, the others report
   "no outline" too.

### CAM (`packages/cam`)

1. **No drilling.** Pin holes, dowel holes and hinge cups are milled as pockets with the
   3.175 mm bit.
2. **Warnings give heights from the board's bottom** ("z=12" for a 6 mm pocket), and
   corner warnings don't say where.
3. **Outline inside corners** in finger joints and notches get no warning, though a
   round bit leaves them rounded.

Rebates and grooves drawn past the part used to warn about material "left in corners".
That material was in the waste past the edge, not on the part: CAM already runs open
pockets out of the edge. The warning now counts only the part.

### cad-script

1. **The drawing is for reading only.** Labels can still crowd on dense parts.

## Next, in order

1. **Joints the model can't cut yet:** box joints between two fingered boards,
   half-laps and cross-laps, and relief that leaves a tool's own shoulders square.
2. **Report:** say where relief and constraint warnings are, warn when pattern copies
   vanish, count edge notches apart from holes, and let `expect` follow variables.
3. **Drilling operations** for holes up to the bit's size and for hinge cups.
4. **A fifth furniture run** once the joints exist, measured against these four.
