# Furniture construction patterns

Investigation and implementation plan for #585. Geometry checks below do not
establish a load rating, material strength, adhesive performance or tipping safety.

## Preserved evidence

The original ZIP is attached to [issue #585](https://github.com/plainoss/camNC/issues/585).
Its unmodified JSONs are saved as `furniture-original-panel-chair.json` and
`furniture-original-frame-stool.json` in `packages/cad-script/fixtures/designs/`.
Their SHA-256 hashes are respectively
`2cb26209c13b4a8199493f7ab88fcd829661d2abebb49693a2dd41041c1072d3`
and `d1c1d7430293051728ce842ce3051cc1b15e677b5599786630c44cea3a528184`.
Full checks on main c90dd09 reproduce solved, collision-free assemblies. The chair
still has one unused empty part and the nested corner-residual warnings; the stool
still has its loose seat and nested leg-corner warnings. These are negative inputs,
not examples of complete construction.

## Source basis and scope

The USDA [Wood Handbook, chapter 8](https://research.fs.usda.gov/treesearch/62253)
requires fastening design to account for grain and moisture movement. Its bolt
discussion depends on member geometry, grain direction and material properties;
those properties are absent from the original inputs. We do not calculate a
capacity from dimensions alone.

[Chapter 10](https://research.fs.usda.gov/treesearch/62250), pages 10-16–10-17,
explains the limitation of plain end-grain connections and why interlocking
end-to-edge joints provide useful edge-grain bonding surfaces. Its bonding-process
sections require suitable surfaces, moisture condition, adhesive and pressing.
Naming glue does not establish that those conditions have been achieved.

The implementation will choose and generate complete construction patterns before
checking them. Diagnostics support that choice; they cannot turn an open rebate
or loose seat into an acceptable completed proposal.

## Proposed panel pattern

For measured sheet stock in a dry interior, use shouldered through-tenons with
accessible removable tusk keys. The seat, back, lower rear rail and a front apron
tie the sides together. The seat has two separated tenons per side, leaving solid
material at the front of every receiving mortise; back and rails have closed
mortises with material behind them. Keys pass through actual outboard tenon slots
and mechanically block side separation. Matching cutter relief is generated on
both mating geometries. Key projection changes the outside envelope and must be
reported explicitly. No friction-only retention or unspecified glue is assumed.

Assembly order: insert crosspieces into one side, bring the second side onto the
remaining tenons along the same axis, then insert keys from accessible directions.
The geometry review must measure tenon engagement, key/slot fit, end ligaments,
closed mortise margins and withdrawal obstruction. It must probe each intermediate
insertion sweep, not infer sequence feasibility from the final collision count.

## Proposed frame pattern

For straight-grained conditioned solid stock, use a permanent glued frame with
shouldered rail tenons, distinct from the panel pattern. Aprons and footrest rails
have reduced tenons rather than full-section end rebates. Perpendicular mortises
must leave a measured web after cutter relief. If the original small leg cannot
accommodate the connection, enlarge or laminate the member instead of intersecting
the mortises or silently reducing engagement.

The present CAD model represents flat profiles with machining from their two broad
faces. It explicitly refuses material removal that enters neither broad face
(`cutParts.ts`: “sits inside ... without reaching either face”). A bounded prototype
will therefore investigate legs laminated from the available stock: machine the
interior mortises while the lamination faces are accessible, then bond the leg
halves. This is an explicit manufacturing/layout choice, not a hidden side-face
machining operation. Exact member and tenon proportions remain prototype decisions
until remaining-section and cutter-fit measurements pass.

The seat bears on the completed frame and is positively attached through accessible
cleats or buttons. Hardware/pilot/clearance holes and installation access must be
modeled and specified. Solid-wood seats require slots in the movement direction;
fixed plywood seats use their separately stated material assumption. Do not glue a
solid seat rigidly across its grain to the entire frame.

Assembly order: machine and bond leg laminations, assemble two leg frames, join
them with the remaining rails, square and clamp until the adhesive's specified
cure, then install the seat attachment from below. A rail framework in both
horizontal directions supplies the intended racking load paths; geometry is not a
cyclic-racking test.

## Acceptance-to-implementation map

1. Preserve the two originals and full reports; assert their exact hashes and
   independently measure the missing retention/seat attachment as negative cases.
2. Implement small trusted panel/frame builders that emit ordinary editable CAD
   steps, actual mating features and an explicit construction/assembly plan. Reuse
   #572's recipe catalog/tool interface when available; do not invent another
   assistant runner or duplicate its immutable-script and finalization machinery.
3. Measure evaluated geometry: tenon/shoulder dimensions, engagement, remaining
   ligaments and intersecting mortises, cutter-compatible fit, retention and seat
   fastening features. Include nested CAM warnings in the relevant report.
4. Add comparable saved tasks that generate these patterns initially. Assess actual
   material/connection geometry, not descriptions, names or keywords. Weak loose
   seats, open unretained housings, shallow full-rail rebates and destructive
   mortise intersections must trigger a repaired layout before proposal.
5. Exercise complete panel and frame workflows: source edits, measured stock and
   cutter changes, reload and retained identities, assembly insertion/access and
   full CAD/CAM handoff. Run the core/UI lanes once ready. No model calls or API
   spend is required or authorized for these deterministic checks.

This document records the proposed approach, not completion of those checks.

## Implemented patterns

`panelChair(options)` builds the keyed panel pattern above. `frameStool(options)`
builds the frame pattern: two `legLayer` laminations per leg, aprons and staggered
footrests with tenons shouldered top and bottom, and two seat cleats tenoned into
the side aprons in closed mortises. Four purchased 5 × 40 mm screws drive up through
the cleats into blind pilots in an 18 mm plywood seat. The mortises and shoulders
are relieved for their own `mortiseCutter` (6 mm by default), so the deepest
leg mortise is about four times its diameter; the small `cutter` mills the
pilots. Both builders refuse sizes
or stock outside their stated bounds, take an `at` origin, and save their
construction plan.

`checkFurnitureConstruction(document, parts, plan)` measures each plan on the
evaluated geometry. For every glued shouldered tenon it measures engagement,
shoulders, the closed mortise walls, that the receiver is actually empty where
the tenon sits, and the web left between relieved mortise cells in one receiver.
It also checks lamination contact, the fastened seat and the purchased hardware.
Inspection reports each failure as a `construction-check` error, so a design whose
edit makes a joint shallow, intersects two mortises, suppresses a mortise step or
shortens a seat screw no longer checks as complete. The design assistant builds
chairs and stools from these patterns by default, and the saved `stool` task only
passes a built stool whose measured construction checks pass. These are geometric
pattern bounds, not load ratings.

## Bounded feasibility results

`furniturePrototype.test.ts` exercises two partial joints, not whole furniture:

- One 18 mm panel has an enclosed through mortise for a seat tongue. A transverse
  rectangular key blank passes through the outboard tongue slot. Translating the
  seat and key 1 mm in the withdrawal direction produces a collision with the side;
  removing the key makes the same translation unobstructed. This establishes the
  intended geometric blocking mechanism. The blank is not yet a finished tapered
  key and this probe does not establish key retention in its insertion direction.
- Two 40 mm laminations form an 80 mm square leg. Perpendicular rail ends each have
  a 24 mm engagement, 40 mm tenon height and 15 mm top/bottom shoulders. Their 18 mm
  widths leave 7 mm nominal separation; cutter relief reduces that separation and
  still needs independent measurement before adopting the proportions. All three
  mortise removals reach exposed lamination faces and the final assembly has no
  material collisions. This is evidence of manufacturing representability, not a
  bond, joint-strength or complete-frame assessment.

Both prototypes pass their full `editCad` check, including the existing CAM report.
The two original golden reports and two original SHA checks pass independently.
