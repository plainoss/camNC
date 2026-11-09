# Part Studio feature model

In the design model today, a part owns its sketch, and its extrude is a property of the part (thickness, thin, drawn-on). The feature list is derived from the parts. That's enough to build boards one at a time. It can't express the workflows a parametric part studio teaches first:

- picking which regions of a sketch to extrude
- extruding one sketch several times
- finishing a sketch without making a part
- inserting a step at the rollback bar, and reordering steps

This plan moves there in stages. Every document saved today keeps loading, and every stage ships on its own.

## Stage 1: stored order, and sketches that aren't parts yet

- `CadDocument.order?: string[]` stores the feature list's step IDs in order: `part:sketch`, `part:extrude`, face sketches, cuts, copies, patterns, part cuts, and variables. `designSteps` follows it when it's set, and falls back to today's derived order otherwise. New steps go in at the rollback bar. Reordering is allowed where dependencies allow it.
- `CadPart.extrude?: false` marks a part whose sketch is finished but not extruded: a sketch feature. It isn't in the parts list, the 3D view, CAM or reports. It shows as "Sketch N" in the feature list, and its sketch shows in the studio, so later sketches can see and use it.
- Finishing a new sketch opens nothing. The sketch stays a sketch feature until Extrude is started, from the toolbar, with Shift+E, or from right-clicking a region.

## Stage 2: Extrude picks regions

- `CadPart.regions?: string[]` holds the stable region IDs (`sketchRegions`) of the sketch that are extruded. Left out, it means the whole sketch, as today: its outer outline, with inner loops as holes.
- With regions set, the part's profile is built from those regions alone. A sketch can then have intersecting or unused geometry, as construction-free sketches in the reference do.
- The Extrude dialog's selection box lists the picked regions. Clicking regions in the view adds or removes them.

## Stage 3: one sketch, several features

- `CadPart.sketchOf?: string` points a part at another part's or sketch feature's sketch instead of its own. `resolveExtrudeSteps` keeps a copy of that sketch on the part, on the same plane or face, after every change and every solve, so editing the shared sketch updates every feature that uses it. The copy's IDs are the sketch's own: checks and the solver skip it. When the sketch's owner is deleted, the first part still using it owns it.
- Extrude on a part whose sketch has regions none of its extrudes use makes a new part of those regions, sharing the sketch. When the extrudes use all of it, Extrude opens the part's own, as before. Picked regions that touch make one part; regions apart are refused.
- The Extrude dialog's operation tabs are New / Add / Remove:
  - `CadPart.addTo` makes the step an Add: its regions join a part made from the same sketch, written to that part's `addedRegions`. Merge with picks the part.
  - `CadPart.remove` makes it a Remove: its picked regions, or every closed region but what's left of the face, are cut into the board the sketch is drawn on. The board gets a face sketch and cuts marked `removedBy`, kept in step with the step. The step keeps its own sketch, and the feature list shows it as an extrude, not as the board's cuts. This replaces the `extrudeRemove` converter.
  - Add and Remove steps aren't parts: they're left out of the parts list, the 3D view's parts, CAM and reports.
- Not yet: one Extrude of regions apart making several parts, a Remove reaching parts other than the board it's drawn on, Add across sketches, and Intersect.

## Stage 4: references to other parts

A shared reference type names a face, edge or vertex of a part by its lineage, not by its index. It's used by:

- Use, so linked edges follow the part
- picked directions for Transform and Pattern
- Up to face
- Shift+S on a picked face

## Not changed

Boards stay flat profiles with a thickness. CAM keeps reading parts the way it does today. Joints, clearance and corner relief stay where they are.
