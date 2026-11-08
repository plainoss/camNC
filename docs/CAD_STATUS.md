# CAD status

The sketch editor creates flat parts in millimetres. Closed profiles can proceed
to board arrangement and machining. Construction geometry remains
editable but is excluded from cut profiles.

Clicking an inner loop or a face sketch's region, on the drawing or on the part in
the 3D view, sets how deep it's cut, or leaves it uncut. The 3D view also has a drag
arrow, and a cut can be switched off without losing its depth. An inner loop stays a
through-hole unless given a depth. A face sketch is
a separate drawing on the top face, so it can cross the part's outline, which is how
a rabbet is drawn. Its regions are bounded by its curves and the outline. Cuts reach
CAM as exact polygons.

Supported drawing tools include lines, corner and center rectangles, circles,
three-point and tangent arcs, points, conics, fit splines, and Bezier curves.
Sketch fillets can share a radius across multiple selected corners. Dimensions
and geometric constraints support editing, deletion, and undo/redo. Rectangle
corner joins can be removed, and spline endpoint-handle points and segments can
be selected independently.

Dimension annotations follow geometry during drags and value edits, retaining
manual placement through Undo/Redo and reload. Saved absolute annotations convert
without moving their initial position.
Outside-span placement and tiny geometry use bounded offsets to avoid amplified
label movement. Value fields hide their default unit hint when the text already
contains units. Legacy unit-only entries normalize without creating a new CAM
revision.

Offset supports finite lines, circles, arcs, and closed line/arc loops with a
shared signed distance. Mirror creates linked point, line, circle, and arc
copies about a straight axis. Extend operates on line and arc ends; an explicitly
selected construction boundary can retain a persistent contact.

Accepted geometry and draft edits persist with the project. Returning to the
sketch retains source geometry, dimensions, and CAM settings. Invalid profiles
remain drafts with a visible explanation while CAM retains the last accepted
geometry. Machining revision and physical-sheet checks can require a new sheet
after geometry changes.

Current limits and deferred work:

- Sketches go on the top face, the underside and pocket floors. The camera turns to face the surface, then the flat sketch editor opens. An underside sketch is drawn as seen from below, so its X runs the other way.
- Underside cuts make a side B program from exact polygons. Cuts from the two faces that would meet are refused. No side B program from camNC has been cut on the machine.
- Partial or open multi-edge Offset chains and rational-curve Offset are unsupported.
- Mirror rejects conics, fit splines, and Bezier curves.
- Rational curves can bound Trim or Extend operations, but cannot themselves be interval-trimmed or extended.
- General Symmetric, Concentric, Normal, and Curvature constraint commands are deferred.
- Project/Use, sketch patterns, and slots are deferred.
- Adding a fit point to a periodic spline is unsupported. Bezier degree is limited to 15.
- Inserting a spline fit point may reshape unconstrained geometry while retaining fixed points and driving dimensions.

The [browser regression recipes](../apps/camNC/e2e/cad/README.md) and
[declarative behavior specs](../apps/camNC/e2e/spec/README.md) describe how to run
the checked-in checks. Passing those checks establishes their stated coverage,
not complete CAD tool coverage or a physical machining run.
