# CAD roadmap

Where camNC's integrated CAD goes after the sketcher: pockets, one 3D view, then
assembled flat parts and cupboards. Each PR below merges and ships on its own.
Tick a PR off here when it merges, and update the plan when the code proves it
wrong.

## Decisions

- **One 3D view.** Faces and regions are picked directly on the part. There is no
  second view to keep in sync.
- **Top, underside and pocket floors first.** These only need polygons, so no
  geometry kernel is added. Sketching on edges is deferred, so end-grain holes
  wait too. Asking for edge cuts or angled joints is what reopens the kernel
  decision.
- **Parts and joints are the saved design.** A part holds an ordered feature list,
  and the document holds placements, joints and variables. Joints generate cuts.
- **A generator writes that same data.** It fills in a normal model and gets out
  of the way, so hand edits and later size changes both keep working.

## Constraints from the existing code

- `evaluateCadPart` treats every inner closed loop as a through-hole, and saved
  jobs rely on it. A loop stays a through-hole unless it is given a depth.
- A line across the outline makes a part invalid. A rabbet's region therefore
  comes from a separate sketch, with the part outline included when regions are
  worked out.
- `designGeometryKey` identifies what has been cut. Parts with no cuts must keep
  exactly the same key, or existing physical sheets would be flagged as out of date.
- `CadEditor` is a large SVG editor with many tests. To sketch on a face, the
  camera faces the surface and that editor is aligned on top of the 3D view. It is
  not rewritten in 3D.
- CAM holds a part by one outline, so a through cut can't reach the edge or leave a
  loose piece. Those are refused, and the fix is to change the profile or use a
  separate part. Depths that don't fit are refused too, so a pocket never quietly
  becomes a through cut.
- Floors, walls and top faces come straight from the stacked slabs, so each
  triangle can be tagged with its face for picking. No general boolean code is
  needed.

## Order

```
Pockets:   1 → 2 → 3 → 4 → first test cut
One view:  4 → 5 → 6 → 7
Variables: 7 → 8 → 9
Workspace: 9 → 14 → 15 → 16 → 17 → 18 → 19
```

## Milestone 1: real pockets

Pockets that can be designed and cut, from the existing sketch editor.

### PR 1: Move sketch regions into the CAD package with stable IDs (merged, #169)

`refactor(camNC) Move sketch regions into the CAD package with stable IDs`

- Move `sketchRegions.ts` into `@wbcnc/cad`. Each region's ID comes from its
  bounding curves and the side of each curve it lies on.
- The side matters because all three regions of two overlapping circles touch the
  same two curves. Regions with the same signature, such as the lenses between a
  wavy curve and a line, are told apart by their order along the curve.
- **Done when:** nothing visible changes, and IDs survive solving, dragging and
  reloading. Trimming a curve may change an ID, and PR 2 reports that.

### PR 2: Save cuts and face sketches on parts (merged, #174)

`feat(cad) Save cuts and face sketches on parts`

- Add an optional ordered `features` list: sketches on a face (`top`, `underside`
  or `floorOf: cutId`), and cuts with a region and a depth or through.
- Evaluate these into `EvaluatedCadPart.cuts`, with errors for a missing region or
  a lost face. Regions report their nested islands here, because a cut needs them.
- Keep `version: 1` for documents with no features, and use `version: 2` for any
  with features, so an older build refuses the file and doesn't drop pockets.
- **Done when:** old documents round-trip byte for byte. There is no UI yet.

### PR 3: Send native pockets to CAM from polygons (merged, #177)

`feat(cam) Send native pockets to CAM from polygons`

- Add `featuresFromCuts`, which builds levels, pockets and open-edge regions
  directly from polygons, keeping exact curves.
- Update `nativeCadModel.ts` to produce slab meshes and `shape.pockets`, and add
  cuts to the geometry key.
- **Done when:** results match `extractFeatures` on the same slab mesh, which is an
  independent check, and keys for parts without cuts are unchanged. Top side only.

### PR 4: Set pocket depth on a sketch region (merged, #178)

`feat(camNC) Set pocket depth on a sketch region`

- Click a region in the sketch editor, then type a depth or choose Through or None.
  Shading shows the depth. PR 5 reuses this popup.
- Add a separate sketch for rabbets.
- **Done when:** a design with a recess, a slot and a rabbet goes from design to
  G-code in an end-to-end spec.

**Then do a physical test cut.** It doesn't block merging. Compare it with the
Fusion program for the same part, because no camNC program has been cut yet.

## Milestone 2: one 3D view

### PR 5: Edit cuts directly on the 3D part (merged, #181)

`feat(camNC) Edit cuts directly on the 3D part`

- Add a 3D view to the Design step, with hover highlights, click-to-cut, a drag
  arrow, and a feature list with on/off and delete.
- **Done when:** a recess and a through slot can be made without opening the sketch
  editor. Regions still come from a sketch, so this is about setting depths, and PR 6
  brings drawing them into the 3D view.

### PR 6: Sketch on the top face and pocket floors (merged, #188)

`feat(camNC) Sketch on the top face and pocket floors`

- Click a face, and the camera moves to face it with the editor aligned on top.
  Finish returns to 3D.
- Sketches on a floor follow the pocket's depth. If the pocket is removed, the part
  shows the lost face and offers a fix.
- Aligning the editor over a tilted 3D view would mean rewriting how it reads the
  pointer, so the camera turns to face the surface and hands over to the full-screen
  sketch editor. Drawing in place at any angle would be its own project.
- **Done when:** a pocket inside a pocket works end to end, and 3D is the default
  view for parts.

### PR 7: Add underside sketches and cuts (merged, #191)

`feat(camNC) Add underside sketches and cuts`

- Add the underside to the 3D view, with mirrored features passed to
  `flippedFeatures` in place of mesh extraction.
- Set `bottomFaces`, so the side B warning and plan appear.
- **Done when:** a part with cuts on both sides produces a correct side B plan, with
  holes in matching positions.

## Milestone 3: variables and placement

### PR 8: Add design variables (merged, #208)

- Document variables such as `width` and `board` drive dimensions, thickness, cut
  depths, positions and pattern counts. A value that can't be used keeps the part's
  last good shape and shows an error on it.

### PR 9: Place parts in an assembly (merged, #210, #212)

- Placements, copies and mirrored copies, with a collision check. Testing it by hand
  showed that placing finished parts against each other isn't how furniture is
  designed, so the Assembly view leaves the UI in milestone 4. Its internals stay, as
  the way a part follows the face it was drawn on.

## Milestone 4: Part Studio

Furniture is designed by building parts up in one 3D view, each drawn on a plane or
on a face of a part that's already there, so it follows that part. Two reference
designs set the bar: a **hanging shelf** (two sides with a hook, a back and two
shelves housed in grooves, dogbones) and a **cutlery insert** (a frame of four
boards with finger-jointed corners, and separators patterned across it with
tenons). Each PR below is checked by rebuilding those designs by hand, as far as
the PR allows.

The 3D-printed connectors in the cutlery insert are out of scope.

```
Workspace:  14 → 15 → 16 → 17 → 18 → 19
```

### PR 14: One workspace with a feature list

`feat(camNC) Show the design as one workspace with a feature list`

- The design opens in one 3D view with every part where it sits. The sidebar lists
  variables, then the design's steps in order (each part's sketch and its
  thickness, its cuts, copies, cut-parts steps, relief), then the parts.
- Clicking a step or a part selects and highlights it. Opening a part's sketch or
  cut uses the existing flat editor and part view.
- The Assembly view, "Put against" and typed positions leave the UI.
- **Done when:** an existing design and the scripted cupboard open with every part
  in place, and each step can be opened from the list.

### PR 15: Draw a new part on a plane or a face

`feat(cad) Draw a new part on a plane or on another part's face`

- A part records what it was drawn on: a base plane, or the top, underside or an
  edge face of another part, plus a start offset and which way it grows. Its
  placement follows from that, so it moves and resizes with the part it's on.
- "New part" in the workspace: pick a plane or a face, sketch in the flat editor
  with that face's outline shown, then set the thickness (often a variable).
- **Done when:** the hanging shelf's sides, back and shelves can be drawn by hand,
  and changing its width and height keeps them together.

### PR 16: Cut parts with a clearance

`feat(cad) Cut one part with others, with a clearance`

- A step that cuts the parts it's given out of other parts, with a clearance all
  round, wherever they reach in: grooves, housings, mortises for tenons drawn on the
  other part. Through cuts that reach a part's edge become notches in its outline.
- **Done when:** the hanging shelf's back and shelves sit in grooves cut into both
  sides with its tolerance, and it holds through changes to width, board and
  tolerance all the way to nesting.

### PR 17: Copy and pattern parts

`feat(cad) Copy and pattern whole parts`

- Copy steps and part patterns along a direction, with the count from a variable.
  Every part and copy has its own name.
- **Done when:** the cutlery insert's separators are patterned across the frame and
  follow the separator-count variable.

### PR 18: Rebuild the reference designs

`test(camNC) Rebuild the hanging shelf and cutlery insert`

- Both designs as saved fixtures built only with the workspace's steps, checked
  through to boards: sizes, cuts, no collisions, and a change of their main
  variables.
- **Done when:** both rebuild, change and nest without hand fixes.

### PR 19: Sketch in place in 3D

`feat(camNC) Sketch on a face without turning the view`

- Draw on the face in the 3D view itself, with the other parts' edges to snap to.

## Known workflow gaps in the Part Studio

The studio follows a parametric part studio's workflow. Where it still differs, to be closed later:

- **Extrude takes the whole sketch.** A part's extrude pushes out its whole outline. Picking which of a sketch's
  regions to extrude, and extruding several regions into separate parts, is not there yet.
- **Extrude has New and Remove, not Add or Intersect.** Remove works on a sketch drawn on a board's top or underside.
  It cuts the sketch into that board, Blind to a depth or Through all, as a face sketch with its cuts. It cuts every
  closed region except what's left of the face: of the regions bounded partly by the board's outline, the largest is
  taken to be the board. Picking regions comes with region selection. The per-part pocket view still works alongside.
- **Used edges are fixed copies.** Use (U) puts a part's edges in a sketch where they are, picked first, then U. They
  don't follow the part when it changes.
- **Pattern and Transform directions are typed axes**, not an edge or face picked in the view.
- **Booleans only subtract** (Cut parts); there is no union or intersect, since parts are boards.

## Not in this plan

- Sketching on edges, and angled joints.
- Fillets and STEP export.
- Undoing through feature history with a rollback slider.
- Rerunning a generator over edited parts.

## Riskiest points

- **PR 1:** if IDs aren't stable, cuts detach from their regions and everything after
  it is affected, so its tests should be the strictest.
- **PR 6:** see the fallback above.
- **PRs 2, 6 and 11** look like the largest, judged from reading the code.
