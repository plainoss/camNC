# Cupboards and the design assistant

In the Part Studio, **Insert → Cupboard** creates a folder of normal parts,
features and variables. Preview the result, then apply it as one undo step.
Inserting again creates another folder with independent variables. Each shelf
is an instance of an ordinary part pattern. Changing the folder's dimensions
edits the variables; it never reruns a generator.

The feature list groups the folder's variables and steps. Folders can be
collapsed, renamed, suppressed, moved, unpacked or deleted. Suppressing a folder
preserves each child's setting. A variable used outside the folder prevents
deletion and lists its users. Variable names are unique throughout the design;
an inserted name clash gets a suffix.

Detaching an ordinary copy preserves its placement and redirects dependent faces,
corners, directions and mirror planes to the new part. A mirrored detach snapshots
its evaluated contours and cuts as editable polygon sketches at the evaluator's
curve tolerance. It refuses a mirrored copy with external face or corner references,
or any copy referenced through an inherited joined body; remove those references
before detaching. Detach also refuses a source with active joined Add bodies, which
are outside its own sketch. Suppress or remove those Add steps first; inactive Add
steps stay with the source family and are not copied into the detached part.

## Connection and conversation

Open **Assistant**, then **Connection**. Enter your provider address, model ID
and key. Anthropic uses Messages. Compatible providers can use Responses or
Chat Completions. Choose the protocol the endpoint implements and mark whether
that model supports tools and images. Tools are required. Image support enables
reference attachments and sends rendered candidate views back for inspection.

Requests go from the browser to the selected provider. The key stays in memory
unless **Remember key on this device** is selected. Remembered keys use their own
localStorage entry, outside account settings, server sync and settings backups.
**Forget key** removes that entry. A provider that refuses browser requests
produces a connection error; the application does not silently proxy the design
or key through a server. Live provider access still depends on the endpoint's
CORS policy and the user's account and model permissions.

Describe a change or a whole piece, such as a shelf or stool. For a look, attach a
PNG, JPEG, WebP or GIF. References are limited to 1600 pixels on their longest
side; GIF references use the first frame. When dimensions or joints are unspecified, the assistant
asks for them or proposes choices before building. Earlier conversation
constraints remain in subsequent requests. Conversations are retained in memory
for the current app session; they are not saved into a design or account settings.

Send with **⌘+Enter** on macOS or **Ctrl+Enter**; plain Enter inserts a new line.
Suggested replies appear as clickable cards. For visual decisions, the assistant
can include simple **Illustration** thumbnails alongside the choices. These are
schematic concepts, not checked CAD previews; custom typed replies remain available.

The assistant reads the guide and examples, checks a script on a copy and repairs
it. Each attempt starts from the original snapshot. Stop cancels provider access
and terminates a running script. A turn is limited to five checks and twelve model
responses, including one final response without tools once the check budget is
exhausted. Identical scripts on the same snapshot reuse their check result.
Changing the open design during a run stops further provider calls. Its output
is a checked proposal or a question; incomplete and refused responses never
publish a candidate.

## Usage and limits

**Usage and limits** shows the last turn's request/check counts and provider-reported
input, output and cached tokens. Enter the selected model's prices to calculate
USD cost. Missing usage or cache prices remain **unknown**, rather than appearing
as zero. Prices and limits last until the dock closes; verify them after changing
the provider or model.
If a provider omits cache-write counts and bills writes at its normal input rate,
select **Cache writes are billed at the input price**. This explicit pricing
choice permits cost calculation while the unreported write count stays unknown.

Anthropic connections enable five-minute prompt caching by default. Connection
settings can disable it for an endpoint that does not implement caching. Stable
tools, instructions and the core guide have explicit cache boundaries; automatic
caching also covers the growing conversation. Cache writes are billed, and a
short prompt may not meet the selected model's cache threshold. Signed thinking
blocks stay attached to complete tool batches so their removal does not invalidate
the provider's context. Other providers do not receive Anthropic cache fields.

The default limits are 120,000 input characters per request, 8192 output tokens
per response, six images totalling 20 MiB per request, 90 seconds per provider
request and three minutes per run. Character and image limits are separate;
base64 size is not a token estimate. Optional total-token and USD limits stop
between requests. A request already in flight can exceed the remaining aggregate
allowance. A capped run stops if the provider omits the usage needed to account
for it. Failed requests may still have been billed; their usage is unknown and
they are not automatically retried.

The displayed session transcript remains intact. Provider requests preserve
earlier user constraints, final decisions and apply/discard events, while removing
superseded repair scripts, reports and candidate images. A short guide provides
the core API; detailed guide sections, examples and report data are available on
demand. Diagnostics, cuts and joints remain in the summary. Visual checks are
requested explicitly, and are automatic when the latest user message attaches a
reference image. Only the latest candidate's views are retained for inspection.
Switching to a text-only provider preserves the conversation with explicit image
availability notices. Oversized context stops before sending rather than silently
discarding user constraints.

## Review and acceptance

**Review proposal** opens the checked candidate in a 3D view. Orbit it or switch between
the original and candidate. The review lists added, changed and removed steps,
new warnings and lost cuts or joint openings. A successful geometry check does
not establish that a piece matches a picture or that its joints are strong.

Only **Apply as one undo step** changes the open document. A hand edit made after
the request invalidates the proposal, including when that edit has been undone.
Closing the review, including with Escape, keeps the same checked candidate and warnings available through **Review proposal**, even after closing the assistant or editing a sketch. A changed design marks the proposal out of date: it can still be reviewed, but Apply stays disabled. **Discard proposal** explicitly removes the candidate without changing the document or undo history. **Insert →
Review design file** uses the same guarded path for a candidate with the open design's
ID; importing a different design remains the Projects workflow.

The assistant cannot apply, finish a job or make a machine program. Finish and
CAM acceptance remain the ordinary manual workflow.

## Execution and saved tasks

Scripts execute in a disposable worker hosted by an opaque sandboxed frame. The
runtime and solver are bundled locally. CSP blocks external connections, the
opaque origin denies application storage, and no key or apply capability is
passed in. Scripts load as local native modules; CSP disables JavaScript string
evaluation while permitting the solver's WebAssembly. User code remains arbitrary
JavaScript: the disposable opaque worker is the security boundary. A private
message channel carries results. The application inspects
the returned ordinary document again using its own runtime before trusting a
successful result. Stop and the timeout terminate the worker, including an
infinite loop. The same script API validates method and option names at runtime.

The model-facing report compacts sketch patterns while the full report keeps
their detail. Top, front and right views use evaluated contours, holes and cut
floors; named-cut sections show the remaining material. These views are also
available through the CLI and MCP server.

The saved-task catalogue in `packages/cad-script/fixtures/tasks` contains the nine
trial requests and three whole-piece briefs. Its outcomes are stated separately
from the recordings. Recorded runs measure the loop and check the historical
attempts; they are not a fresh model comparison. Visual and construction review
remain explicit human-review outcomes. See the package README for the task and
comparison commands.

`apps/camNC/src/cad/assistant/taskBenchmark.ts` connects these saved-task outcomes
to the same `runDesignAssistant` loop used by the dock. It accepts either a fresh
provider adapter or recorded tool messages and keeps provider usage and human
review separate from automatic geometric outcomes. The browser tests include
independently authored cable-hole and shoe-bench smoke trials with real sandbox
checks. These trials exercise guide usability and production-loop behavior; they
are not live-provider comparisons or evidence of billed savings.

A separate history smoke trial checks the 15 mm stock change, retained 6 mm back
and 3 mm pin-hole floor. It also exposes a limitation in the saved starting
fixture: all four shelf housings remain despite an earlier request to keep only
the second fixed. The trial reports that discrepancy explicitly; its automatic
C3 assessment does not establish that the earlier housing request was satisfied.

## Live tray efficiency experiment

On 2026-11-10, live `claude-sonnet-5-5` requests used the production loop and
isolated browser checker for an agreed 280 × 190 mm organic tray, a 40 mm blank,
one 30 mm pocket, a 10 mm floor and an 18 mm wall. Each run started with a fresh
conversation and empty document. Repeated optimized runs intentionally reused
the provider's prompt cache.

| Configuration                                                          | Runs | Requests per run | Checks per run | Mean input tokens | Mean output tokens | Mean time | Mean usage-priced cost |
| ---------------------------------------------------------------------- | ---: | ---------------- | -------------- | ----------------: | -----------------: | --------: | ---------------------: |
| Previous guide-retrieval workflow, no cache controls                   |    3 | 7, 6, 6          | 4, 3, 3        |            38,259 |             11,917 |     103 s |               $0.19569 |
| Cached core guide supplied up front, editable pebble example available |    3 | 3, 3, 3          | 1, 1, 1        |            14,710 |              1,646 |      22 s |               $0.02600 |

All six candidates met independent size, thickness, pocket depth, hole count,
floor and wall checks. The optimized runs cost $0.03360 on the first run and
$0.02205/$0.02233 on repeats: about 87% less on average for this benchmark.
Two cache-only intermediate trials also passed. Comparing their usage with the
same token counts priced without caching isolates cache discounts of 24% and
30%; differences between separate generated runs also include model variation.

The `pebble-tray` example constructs four tangent circular arcs and their
constant-width inset analytically, rather than searching for a curve. Its
coordinates remain expressions, so folder variables reshape both profiles.
An independent 240 × 160 mm live holdout with a 30 mm blank, 20 mm pocket and
12 mm wall also passed in three requests and one check ($0.02436). Browser
regressions additionally verify resizing preserves part IDs. The example requires
width greater than height and wall smaller than 0.32 times height.

The complete experiment used 45 requests, priced at approximately $0.92293,
including one excluded holdout with a test-brief substitution error. Costs were
computed from reported usage and the published Sonnet 5.5 rates: $2/$10 per
million ordinary input/output tokens, $2.50 for five-minute cache writes and
$0.10 for cache reads. See the [model pricing](https://platform.claude.com/docs/en/models/sonnet-5-5/overview).
No live calls run in the automated regression suite. This small, single-model
benchmark does not establish quality or savings for other requests. The valid
candidates have different silhouettes; appearance and construction still need
human review.

## Separate tool improvements to evaluate

- **Named recipes with parameters:** check a trusted construction directly without
  generating its full example source again; preserve editable CAD output and the
  ordinary proposal review.
- **Native curves and offsets:** expose the engine's Bézier/spline/ellipse tools
  to scripts, together with useful curve reports. Expose linked line/arc/circle
  offsets first; reliable general curve offsets require additional work.
- **App-owned requirements:** retain confirmed dimensions, floors and identity
  constraints outside the model's script, so omitting `expect` cannot hide drift.
- **SVG sketch assets:** import existing vector artwork once and reference an
  asset handle. Use precise curve conversion, measured bounds, units/transforms,
  hole handling and explicit unsupported-content errors. The existing carving
  rasterizer is not a precision sketch importer. Scaling an inner SVG does not
  give constant wall thickness, and imported curves do not recover design intent.
- **Bounded script patches and selected views:** repair a saved script by revision
  instead of resending it, and request only the relevant projections. A separate
  geometry repair lane could defer toolpath planning, while retaining trusted
  verification and a complete final check.

## Provider protocol references

Protocol schemas were checked on 2026-11-10 with Context7 against the
[Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/client.ts),
[Anthropic message types](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts),
[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
and [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling).
The Anthropic adapter sends the documented browser-access header. Compatible
adapters use the selected protocol rather than assuming every model accepts
Chat Completions. Automated provider tests use recorded responses and never spend
API credit or require a key.
