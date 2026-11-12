# Precision SVG sketch import

`@wbcnc/cad-script/svg` imports vector geometry as native sketch curves. It never inserts supplied SVG markup into a page, loads a URL, executes scripts, rasterizes artwork or infers CAD design relationships.

```ts
const asset = parseSvgSketch(source);
part.sketch = appendSvgToSketch(part.sketch, asset, {
  width: 280,
  height: 190,
  at: [0, 0],
  preserveAspect: true,
});
```

The default fit uniformly contains the drawn geometry within the requested width and height. `preserveAspect: false` explicitly stretches it. Bounds use true curve extrema, including Bézier and rational conic extrema; blank viewBox margins do not affect fitting. Placement is the lower-left of those bounds in millimetres, with upward-positive CAD Y. Absolute SVG units and root viewBox transforms are resolved before fitting; missing physical dimensions use 96 CSS pixels per inch. A single physical root dimension determines the other from the viewBox ratio.

Supported inputs are closed filled paths (`M/L/H/V/C/S/Q/T/A/Z`), rectangles including rounded corners, circles, ellipses and polygons. Filled open subpaths use SVG's implicit straight-line closure. Nested affine transforms, reflections and nonuniform scaling preserve curves exactly. Cubic and quadratic paths become native Béziers; elliptical arcs become rational quadratic conics split at most every 90 degrees, including under shear. The import adds editable point position dimensions, shares endpoints within the imported geometry and leaves existing sketch points independent. It preserves a control polygon, not authored tangency or symmetry intent.

Simple, separated contours honor inherited `nonzero` and `evenodd` fill rules. Redundant nested boundaries are removed, and separate filled elements are composed as a union. Intersections, touching contours and contours too close to certify at the topology check's conservative 0.001 mm flattening tolerance are rejected. Flattening is used only for validation and the dialog preview; native imported geometry remains exact. Disconnected filled islands can be represented in the sketch; the normal CAD check determines whether they form a valid part.

Stylesheets, style/class attributes, scripts, external resources, DTD/entity declarations, text, images, gradients, clipping, nested SVG viewports and strokes are rejected. Convert strokes and text to filled outlines first. Geometry outside an explicitly defined root viewport is rejected rather than silently importing clipped material. Unknown attributes are rejected instead of silently discarding their visual effect. Fully transparent fills and unfilled geometry are unsupported.

Input is bounded to 1 MB, 1,024 elements/segments, 32 nested element levels and finite coordinates within 1,000,000 mm. Topology has separate edge and work limits. Pathological or highly detailed artwork may require simplification before import.

`createSvgAssetStore()` registers source once, returns compact summaries and session handles, and returns independent canonical geometry copies through `get(handle)`. Repair tools can reuse that handle instead of asking the model to repeat XML or large control polygons. Stores accept at most 16 distinct assets; callers own their lifecycle. `SvgImportDialog` offers file selection, safe geometry preview and explicit size/placement, then returns a selection to a caller that constructs a checked proposal. It does not apply the import.

`checkSvgCandidate(base, store, { handle, partName?, thickness?, placement?, toolpaths? })` constructs a new part from trusted asset data, preserves existing document identities, and runs the normal solver/report pipeline. It returns a candidate and report without evaluating JavaScript or applying changes. Toolpath planning defaults off; the manual `SvgInsert` wrapper requests it before emitting a normal review proposal. Existing parts stay present, and disconnected SVG material still has to pass ordinary CAD validation.

`createDocumentSvgAssetRegistry()` isolates asset stores by document and has explicit `release(documentId)` / `clear()` lifecycle operations. The app's `svgAssets.ts` exports a shared registry for manual Insert and assistant tools. Handles are store-namespaced, so a handle from another document or a released session cannot silently select a different asset. Neither summaries nor native saved documents include the source XML.
