# Illustrations for carving

A new carving starts with an empty board, which offers three ways to start:
**Add lettering**, **Open an SVG file** and **Describe it to AI**. The same
three are on the toolbar at the board's left edge, with **Items** and **Board and
bit** under them. Each opens one side panel; clicking it again, or the panel's
close button, gives the board its room back.

Choose **AI artwork** to open the assistant's panel. A dashed box appears on the
board in the nearest clear spot: it sets where the illustration goes and the
largest size it may take. Drag the box to move it, or its corner to resize it;
**Box width** and **Box height** at the top of the panel do the same. The
illustration keeps its proportions inside the box. Its actual cut size appears
in the panel.

Connect a provider key once in the panel, then describe the illustration under
**What should it show?**, such as an owl reading a book or a cute mouse playing
with a ball, or start from one of the suggested ideas. Choose **Line art** or
**Bold shapes**, a **Detail** level (Simple, Balanced, Detailed) and 1, 2 or 4
ideas, then **Generate** (or press Enter). Each variant is asked for a different
composition. The variants appear in the panel. Hover one to preview it on the
board, and click one to pick it. The picked variant is prepared at the box size
and shown on the board in place, with any compact thin or lost spots circled in
red. Moving or resizing the box, the detail level and job edits all prepare the
picked variant again, locally and without another request. **Refine picked**
sends the current description together with the picked artwork as a revision.
**New ideas** starts again from the description.

The assistant produces filled regions for the existing variable-depth V-carving
workflow. Black means removed material. This does not introduce height-map relief
carving, single-line engraving, or a second machine workflow.

## Generation and local changes

The connected text assistant can produce a restricted SVG in one tool response.
It uses the same provider transport, separate credential store, caching and usage
accounting as the Part Studio assistant. It sends the current brief, physical
constraints and, for a semantic revision, only the current source artwork. It
does not replay old candidate artwork or the CAD script guide.

Image generation uses the shared connection: when it has an image model (chosen
automatically for OpenAI keys), **Image model** is the default generator and uses
the same key and endpoint. With a provider without image generation, such as
Anthropic, the panel says so and Carve uses text SVG unless **Advanced → Use a
different image provider** is ticked; that separate endpoint, model and key stay in the panel until it closes,
and the text-provider key is never copied to a different image endpoint. Native SVG
output requires that separate form and support from the selected model and
project. Image generation and image input are separate capabilities. See the
provider's [image generation documentation](https://developers.openai.com/api/docs/guides/image-generation#generate-svg-output).

Image output can also be a monochrome PNG traced locally into filled regions.
This route uses a short illustration prompt, for example: “Black and white
monochrome line art of an owl reading a book. Low level of detail, suitable for
carving. White background, no shading or text.” It does not ask the image model
to write SVG or obey numeric machining constraints. Those checks happen locally
after generation. Direct SVG remains available as a separate comparison route.
The original PNG stays separate from the traced vector source, and both survive
save/reopen. Tracing thresholds away shading; it reports losses for review and
refuses oversized images, noisy masks or excessively complex contours. Changing
size/detail traces the original PNG again locally at the new tolerances. The API
requests a standard 1024 × 1024 PNG. Source decoding accepts static PNGs up to
2 MB and four million pixels, then downsamples to at most one million working
pixels before contour extraction. **Trace your own image** under **Generate** also
imports an image made with imagegen or another generator, without a provider
connection.

PNG tracing emits closed Bézier contours with filled holes, rather than a path
around every pixel. A disposable worker fits curves, aligns gentle tangent joins
and retains deliberate sharp corners. Near-circular and elliptical contours can
use an independently checked analytic fit to avoid a local curve-fitting dent;
that regularization is reported. Tiny dark specks are removed only below the
physical noise threshold and their removal is reported.

An independent raster comparison checks foreground components, enclosed holes,
coverage and boundary displacement. Open or discontinuous contours and failed
quality checks are refused. Preparation consumes the checked vector approximation
directly, so it does not rasterize smooth PNG-derived curves a second time. Its
curve-to-CAM chord approximation stays within a reported 0.05 mm budget; physical
detail cleanup is a separate, explicitly reported change. Analytical circles,
ellipses, curved strokes, small counters and the actual owl fixture exercise these
guards. These measured bounds and visual inspections do not constitute a promise
that every possible input image can be converted without a visible change.

Check the prepared artwork on the board, the report and, if needed, the cutting
paths in the panel, then **Add to board** or **Discard**. The artwork goes at the
box's centre, and the panel closes with the new artwork selected and an Undo in
the confirmation. **Replace** (offered when an item is selected) keeps the
selected item's identity and rotation, and the button reads **Replace on board**. A candidate whose bounding box overlaps another item
is refused, because combining them could change the carve after checking: the
panel asks you to move the box or make it smaller. Warnings from the checks are
listed under **notes** and do not block Apply; errors do.

Accepted items save their original source, brief and detail setting. Selecting a
generated item and opening the assistant brings that source back in the box for
local rechecks, including without a provider connection. Replacing the artwork
manually ends that generated-source link.

When a token or USD limit is set, the variants are requested one after another so
the limit can stop between requests; otherwise they are requested together.

## Physical detail checks

Simple, Balanced and Detailed currently use provisional feature thresholds of
1.0, 0.6 and 0.3 mm. These are geometric preparation settings, not established
minimums for a particular wood or machine. Material, grain, bit condition,
runout and stock setup still affect the result.

Preparation reconstructs a small SVG vocabulary and rejects scripts, external
resources, styles, fonts, filters and unsupported content. It measures actual
ink, excluding viewport whitespace; fits that ink proportionally; removes small
isolated regions and narrow connected branches; preserves negative space; and
reports changed cut area and narrow remaining lands. Cleanup can change a face,
book or ball, so the source comparison and visual review remain necessary.

The selected V-bit, tip width, depth and optional flat clearing tool are used by
the actual CAM planner in a disposable worker. Checks cover stock fit, depth,
empty results, approximate tip losses and resource bounds. Stop terminates CAM
work, and a deadline prevents an unbounded check. Pixel runs are capped before
polygon union, and contours are simplified before offsetting to avoid raster
staircases inflating into thousands of tiny CAM edges.

These checks do not establish that the subject/action is correct or that the
finished surface will look good. Review the carved surface and normal acceptance
checks in Plan before proceeding to Machine. Physical coupons across materials,
bits and sizes remain necessary to calibrate the provisional detail presets.

## Applying and later edits

Generation and preview leave the saved job untouched. Apply compares the exact
current carving, board and plan with the proposal's source inside the latest-job
mutation, then records one Undo step. A stale or discarded proposal does not
change the job or Undo history. Undo and Redo restore the artwork and source
together.

Artwork size, placement, cutting tool, depth, material or relevant stock changes
invalidate the saved suitability check. Carve, Plan and the machine queue require
a local recheck before using that generated artwork again. Other artwork, board
settings and unrelated job fields are preserved when a proposal is applied.

## Usage and budgets

Usage accumulates across generation attempts while the Carve step is open, including
unusable responses. Local preparation makes no model request. Text-model pricing
uses the shared assistant accounting; unknown usage or prices stay unknown.
Interrupted or failed requests may have been billed and invalidate known totals
rather than silently counting as free.

Token and USD limits stop between requests; a request already in flight can
exceed the remaining aggregate allowance, as explained in the shared Usage and
limits controls. Native image and SVG-authoring charges cannot be calculated
from ordinary text-model token prices. Native generation therefore reports
unknown cost and refuses USD-capped runs instead of applying an incorrect price.

## Verification and recorded experiments

The production generator was exercised with two fresh Sonnet 5.5 requests on
2026-11-10 under a separate approved $10 experiment budget. Usage-priced cost
was **$0.0718293 total**: $0.0350605 for the owl and $0.0367688 for the mouse.
Each used one provider request, with no repair generation. These two smoke trials
do not establish a general success rate or a winning model/generation route.

The original source artwork and usage counts are public fixtures in
`apps/camNC/src/cam/carvingAssistant/fixtures/`. Tests run those recorded sources
through real preparation and CAM without credentials or paid requests. Initial
fixtures exposed excessive contour tessellation; the regression preserves their
successful preparation while keeping the same geometry/work limits.

Focused tests also cover malicious SVGs, detail changes, holes, flat-tip losses,
overflow, cancellation, source reuse, isolated credentials, warning review,
stale proposals, source persistence and real Carve Apply/Undo/Redo. Numeric checks
and human illustration review are separate forms of evidence. Native image-provider
quality and billed cost still need live tests with that provider's credentials;
recorded endpoint tests establish protocol behavior only.

A separate built-in imagegen trial uses the short art prompt above. Its original
1312 × 1199 PNG is `fixtures/owl-imagegen-line-art.png`; the tool did not report
model identity or cost. At a 150 mm / Simple envelope the production tracer
produces 825 cubic curves and 14 straight segments, retaining four filled
components and twelve holes. Measured coverage overlap is 97.46%, with 0.228 mm
maximum measured raster-boundary displacement. Preparation produces approximately
128.2 × 150.0 mm artwork and 718 CAM passes; detail cleanup removes 0.20% of the
source cut area. The eyes, beak, book pages, wings and feet remain recognizable
in visual review. The smooth vector source is `fixtures/owl-imagegen-smooth.svg`.
This is artwork preparation evidence,
not a physical carve or a controlled comparison of models and costs.

`imagegenComparison.test.ts` checks that this actual generated PNG and the direct
SVG fixture both pass the same physical preparation and CAM pipeline. The original
image, traced contours and prepared result can be reviewed separately. This keeps
illustration preference distinct from machining validity and makes it possible to
compare direct SVG with image-first generation without declaring either route
universally better.
