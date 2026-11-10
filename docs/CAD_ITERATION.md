# CAD iteration loop

Work on complete woodworking designs and small diagnostic cases together. A reduced case explains a failure; the original Part Studio remains a regression so interactions between parts are not lost.

## Core and interface checks

Run the core lane from the repository root:

```sh
pnpm --silent cad:iterate
pnpm --silent cad:iterate --list
pnpm --silent cad:iterate --through resize-stock-and-width
pnpm --silent cad:iterate --out /tmp/cabinet-checkpoints
pnpm --silent cad:iterate --workflow divided-tray
pnpm --silent cad:iterate --workflow fitted-joints
```

The cabinet workflow exercises five source parts, a mirrored side, repeated shelves and dependent rebates. Its checkpoints change shared dimensions, grow a pattern, move the shelf stack, change clearance, suppress and restore the housings, and reload the document. Checks specify expected dimensions, world bounds, physical-piece membership and dependency behavior. The hot loop omits toolpath planning; run the affected mesh/planning tests separately when those paths change.

The other two complete workflows each cover eight cumulative states with independent material volumes, connectivity, phase/clearance probes, collision pairs and exact source/copy identities. Their [contracts](../packages/cad-script/src/iteration/WOODWORKING.md) describe the full studios and the separate incomplete `tray-missing-tool` and `joint-unconstrained` diagnostics. `--list` shows all keys and incomplete checkpoints; an explicit `--workflow <key> --list` filters the catalog. The cabinet remains the default.

The radial stool workflow (`--workflow radial-stool`) keeps a seat and repeated upright legs together through stock, radius, count, direction, suppression and reload edits. Its independent geometry checks cover rotated leg placement, occupied volume and cutting-piece membership. The `studio/stool/circular-pattern-edit-reload` interface scenario checks cancel, sweep versus step controls, growth, suppression and reload through visible dialogs. Picked pattern axes are fixed world lines; they do not follow a later edit to the picked edge or face.

The result stops at the first divergent checkpoint and identifies its layer: source, solver, geometry, assembly, cutting handoff or persistence. A requested prefix is explicitly labelled `scope: prefix`; passing it does not establish that the full workflow passes. Unsupported checkpoints exit 2 and remain incomplete.

Artifacts default to `test-results/cad-iteration/core/`:

- `report.json`: checks, timings and the first failure.
- `checkpoints.json`: named checkpoints, exact source hashes and physical-body identities.
- `*.source.json`: the document after the edit and before solving.
- `*.candidate.json`: the solver's result, explicitly candidate-derived.

Other workflow keys get their own subdirectories under that default, so they cannot overwrite the cabinet artifacts. `--out` still selects an explicit directory.

Reference tools must independently interpret source expressions and dependencies. Candidate-derived coordinates and placements can test later geometry stages but cannot establish independent solver or placement equivalence.

Run the interface lane separately:

```sh
pnpm --silent cad:iterate:ui
```

This uses the existing behavior-spec runner and a real browser. The complete-cabinet scenario follows all eight core checkpoints through visible controls: shared stock and width edits, variable creation, three then four shelves, a shelf offset expression, clearance, suppression, restoration and reload. It checks the saved settings, the visible Parts list and physical-part count, and retains each named source part and copy identity in its instance slot when the shelf count grows. Smaller cancel/edit/reload, part-counter and copy-suppression scenarios remain separate diagnostics. Suppressed mirrored and patterned copies leave the displayed list and count while retaining their source identities for restoration.

The browser checks interface and document effects. Reading a saved offset or thickness does not establish correct geometry; the core and mesh gates remain separate. Browser artifacts are in `apps/camNC/test-results/spec/all/`.

Assembled inspection has a separate measurement gate in `apps/camNC/src/cad/studioMeasurements.test.ts`: the complete cabinet and tray meshes retain their expected stock thickness, inside span, planar area and exact divider-copy gaps after parameter edits and reload. Finite face distances use occupied triangles, including holes. The `studio/measure/stock-faces-readonly` browser scenario checks native opposite-face picks, unit conversion and unchanged saved content; native editor tests also cover corners, straight edges, quick Shift selection and witnesses. These are measurements of the displayed geometry; curved outlines remain a faceted approximation.

Section inspection has its own gate in `apps/camNC/src/cad/studioSections.test.ts`. Complete cabinet and tray sections preserve rebates, all 34 pin openings, exact divider tools and physical-instance identity through stock, width, pattern, position and reload changes. Independent material probes and cap areas check voids as well as material. Reduced cases cover holes, blind pockets, islands, diagonal cuts, transformed copies, supporting planes and invalid boundaries. The same clipped mesh supplies rendering, picking and finite measurements; the hatch overlay cannot intercept a click. Native editor tests cover offsets, flip, face selection, precise keyboard and captured-pointer movement, cancellation, camera stability and source/history immutability. The stock and cabinet section scenarios exercise the visible inspector, accepted-setting recall and unchanged persistence separately. Sections remain temporary view state.

The saved `divided-tray-copy-tools.json` diagnostic keeps a complete tray while the `studio/tray/selected-copy-tool` scenario selects its third divider through the Parts list, moves the stack, grows the pattern, reloads and restores family selection. Reduced browser tests cover viewport picks, exact highlighting and selecting a copy before opening Cut parts. These checks retain physical copy identity; they do not establish the tray's complete geometry or reference equivalence. Copy-only targets and consuming one copy remain unsupported and are explicitly refused.

The complete tray scenario follows all eight core states: stock and width, divider growth, an exact third-copy tool, family restoration and movement, linked clearance, suppression, restoration and reload. The fitted-joint scenario follows both joint pairs through stock and height edits, five-to-eight fingers, target/tool exchange, linked clearance, suppression and reload. Both use existing dialogs, feature menus and the Parts list. They check visible membership, linked expressions and source, copy, variable, sketch, pattern and cut-feature identities. Their source and interface assertions do not measure the resulting cuts; the core material gates do that separately.

Use the existing interactive session or render command to investigate a failure instead of repeating a long scenario manually; see [behavior specs](../apps/camNC/e2e/spec/README.md).

## Agent procedure

1. Read the workflow report and select its first unexplained failure. Preserve the full workflow when adding a reduced diagnostic.
2. Confirm the intended behavior from the established reference contract. Reference behavior is the default for feature semantics and interface details; record an unverified detail as an evidence task rather than inventing a local convention.
3. Classify the failure before changing code: source/solver, region or feature evaluation, boundary mesh, assembly, cutting handoff, persistence, or interface. Equal volume does not prove a valid boundary mesh.
4. Add a regression that fails on the current implementation. Keep source expectations independent of the implementation being corrected.
5. Make the smallest coherent correction, then rerun the diagnostic and the original complete workflow. Do not relax tolerances, discard unsupported cases, replace reference expectations with current output, or mark an unexplained difference as accepted.
6. Have a critic review the change and the evidence. Include attempts to make the gate pass with incorrect geometry, missing instances or broken identities.
7. Run relevant checks and the required fast suite before saving a validated milestone. Keep CI/workflow changes separately reviewable.

External observations, captures and comparison results belong in the private companion repository. Public tests use self-contained synthetic designs and remain runnable without private files. Reference generation, review and acceptance are separate from ordinary comparison; accepted captures are never regenerated by a compare command.

## Work priority

Fix regressions in working designs before extending the feature list. Pick missing capabilities from the generated [status checklist](STATUS.md), updating its source when coverage changes. Prioritize complete cabinetry, shelving, divided trays and fitted joints, including multi-part references, clearances and pattern edits. Use these workflows to select the next capability rather than expanding a translator in isolation.

Keep four claims separate: occupied material geometry, valid boundary meshes, parametric feature behavior and interface behavior. A scripted solid construction is geometry evidence; it is not evidence of native dialog defaults or regeneration semantics. A workflow has only the coverage its checks demonstrate.

Measure affected-case runtime, first-divergence diagnosis time, reference-maintenance cost, false alarms and escaped regressions alongside the supported workflow list. The goal is shorter verified iterations, not simply more passing synthetic examples.
