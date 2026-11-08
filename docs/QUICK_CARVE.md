# Quick carve

V-carved lettering and SVG artwork on a board, where placement is by eye. A
carving is its own kind of job with its own Carve step. It hands over to the same
Plan page and Machine view as every other job.

## Decisions

- **Own Carve step.** A carving job's rail shows Carve, Plan, Machine. Carve
  replaces Design and Boards for this kind of job: one page with the artwork, the
  board it goes on, and a live preview of the carved result.
- **One Plan, one Machine.** No carving-specific route, queue, probing or run
  controls. Carving is another source of programs for the existing queue.
- **Text stays text.** The job saves the string, font and size, or the SVG source,
  plus its placement on the board. Outlines are derived, so a typo can be fixed
  later and Plan re-runs.
- **Z0 on the board's underside, for now.** Carvings zero Z like every other job, so the machine flow is unchanged.
  A V-carve's width follows its depth, so the Carve step asks for the board's measured thickness. Probing the top
  instead is a later change to the machine flow.
- **Default bit: 90° V, ⌀6.** The largest V-bit that fits the machine is ⌀8.
- **Placing a carving on a part comes later.** See the last section.

## Constraints from the existing code

- Bits are flat end mills. `showOnMachine` sets the tool shape to `'flat'`, and
  the queue loads programs and prompts for bit changes by `diameter` alone
  (`CamQueueCard`, `useMachineQueue`). Two V-bits of the same diameter but
  different angles would look identical, so tool identity has to include the
  shape.
- `useAppSteps` builds the rail from Design or Model, Boards, Plan and Machine.
  A carving job needs its own step list there, and `openAtMachine` must accept a
  carving job.
- The Boards page owns board size, material, holding and XY zero. The Carve page
  needs a smaller version of those: size, thickness, material and how the board
  is held. Tabs and bottom skin don't apply because nothing is cut free.
- Clamps drawn on the board are checked against the cutter. For a V-bit that
  check must use the collet and shank, not only the tip.

## Order

```
Engine:   1 → 2
Job:      2 → 3 → 4
Machine:  4 → 5 → first test carve
Later:    6 → 7
```

### PR 1: V-bits as tools (merged, #226)

- Add angle and tip flat to bits in the bit library. Default 90° ⌀6, limit ⌀8.
- Tool identity, bit-change prompts and simulation use the full shape.
- Stock simulation removes a cone instead of a cylinder.

### PR 2: Variable-depth V-carve planner (merged, #226; faster in the next PR)

- Worker op: from closed outlines, cut along the centre line with depth set by
  the local width (distance to the outline times `1 / tan(angle / 2)`).
- A depth limit caps it. Wider areas get a flat bottom, cleared first by a
  separate program with a flat bit.
- Headless fixtures: a single stroke, a letter with a bowl, a stroke wider than
  the cone, and an artwork wider than the depth limit allows.

### PRs 3–5: Carving jobs, the Carve step, Plan and the machine (one PR)

- New carving card on the CAM/CAD page. The rail shows Carve, Plan, Machine.
- Lettering (font, text, height) or an SVG of filled shapes. Drag to place and
  drag a corner to resize. A Board tab sets size, thickness, material and holding.
- Live preview of the carved board with flat bottoms marked. Hover reads depth
  and width.

- Plan: clearing program (if any), then the V-carve program, simulated with a
  cone. Depth-limit and fit warnings.
- Machine: the same queue. A V-bit is named in the bit-change prompt, and one
  after a flat bit of the same diameter still asks for the swap.

## Later: show the carving on the assembled model

The Carve step shows the board on its own, so it is hard to judge where the
lettering ends up in the finished piece. The fix is to link a carving to a face
of a part in the design, and show it in the 3D assembly.

- **PR 6: Link a carving to a part face.** In the Carve step, pick a part and its
  top or underside face from the 3D view. The carving then stores the part id, the
  face and its placement in that face's coordinates instead of the board's. The
  board size comes from the part's outline. An unlinked carving works as today.
- **PR 7: Show linked carvings in the 3D view.** Draw the carving on its face
  in the assembly, shaded from the same depth field the Carve preview uses. That
  is a texture and normal map on the face's triangles, so it needs no geometry
  kernel, which keeps to the CAD roadmap's decision. Moving the part in the
  assembly moves the carving with it.

The parts and their cut state must not change because of this. A part without a
linked carving keeps the same `designGeometryKey`, and adding a carving to a
part must not mark its already-cut boards as out of date.

Cutting a linked carving together with its part, in one job and one board setup,
is a further step. It belongs with face-sketch cuts in the CAD roadmap, not here.

## Not in this plan

- Carving on curved or end-grain faces.
- Engraving single-line fonts along a path (no variable depth).
- Photo or greyscale relief carving.
