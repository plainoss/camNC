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
PNG, JPEG, WebP or GIF. When dimensions or joints are unspecified, the assistant
asks for them or proposes choices before building. Earlier conversation
constraints remain in subsequent requests. Conversations are retained in memory
for the current app session; they are not saved into a design or account settings.

The assistant reads the guide and examples, checks a script on a copy and repairs
it. Each attempt starts from the original snapshot. Stop cancels provider access
and terminates a running script. A turn is limited to five checks and twelve model
responses. Its output is a checked proposal or a question.

## Review and acceptance

**Preview proposal** opens the candidate in a 3D view. Orbit it or switch between
the original and candidate. The review lists added, changed and removed steps,
new warnings and lost cuts or joint openings. A successful geometry check does
not establish that a piece matches a picture or that its joints are strong.

Only **Apply as one undo step** changes the open document. A hand edit made after
the request invalidates the proposal, including when that edit has been undone.
Discarding a preview leaves the document and undo history untouched. **Insert →
Review design file** uses the same guarded path for a candidate with the open design's
ID; importing a different design remains the Projects workflow.

The assistant cannot apply, finish a job or make a machine program. Finish and
CAM acceptance remain the ordinary manual workflow.

## Execution and saved tasks

Scripts execute in a disposable worker hosted by an opaque sandboxed frame. The
runtime and solver are bundled locally. CSP blocks external connections, the
opaque origin denies application storage, and no key or apply capability is
passed in. A private message channel carries results. The application inspects
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
