# Test architecture and CI feedback

Run `pnpm run test:fast` for local feedback, plus any slow browser files changed by the work. Run `pnpm run test:ci` after changing task allocation, cache inputs, or workflows. CI runs the complete corpus and isolated performance gates; the fast subset never counts as a full result.

During an edit, run focused test files directly. Both root broad commands (`test` and `test:fast`) acquire the same local worktree lock; CI skips that lock because each suite has its own runner. Waiting for a broad suite does not prevent focused checks. This avoids concurrent agents repeatedly timing out otherwise passing browser tests.

The local headless phase runs one package at a time, matching CI. Each geometry package has its own worker pool, so starting several packages together can oversubscribe the host and exhaust existing test deadlines on cold runs. CAM and cad-script also yield to the event loop between tests so long chains of synchronous geometry and microtask-only awaits cannot starve worker-report acknowledgements. This preserves the existing test deadlines and coverage.

| Boundary                                         | Owner                          | Runtime                 | Coverage                                                                               |
| ------------------------------------------------ | ------------------------------ | ----------------------- | -------------------------------------------------------------------------------------- |
| Cutting recipes and hardware defaults            | `packages/cam-settings`        | Node                    | Pure resolution and identity rules; browser persistence remains tested in the app      |
| Editor commands, selection, sessions and history | `packages/cad-editor`          | Node + real solver WASM | Command rules and command → solve → Undo/Redo workflows                                |
| CAD geometry and CAM kernels                     | `packages/cad`, `packages/cam` | Node + real WASM        | Geometry, toolpaths, safety and complete fixture corpora                               |
| App board decisions and document rebasing        | `test:domain`                  | Node                    | Explicit allocation in `apps/camNC/vitest.node-files.json`                             |
| Auth and database worker                         | `test:worker`                  | workerd                 | Real D1 migrations and request handling                                                |
| UI and browser adapters                          | `test:browser`                 | Chromium                | Layout, pointer coordinates, focus, IndexedDB, worker transport and end-to-end imports |
| Behaviour scenarios                              | `spec:cad`                     | Chromium                | Every declarative scenario, including goldens and known-gap accounting                 |
| CPU budgets                                      | `test:performance`             | Node, then Chromium     | Dedicated serial phase, separate from functional tests                                 |

The application keeps compatibility facades for editor imports. Headless packages depend only on their geometry/kernel package, never on React, persisted stores, app routes, or worker transport. CI checks those import boundaries. Put new semantic editor cases in the headless package; use browser tests when the assertion needs browser behavior. A command test does not replace coverage of picking, keyboard focus, layout, or transport.

The board browser suite is divided into replacement/auto-fill, dragging, holds, and settings. Each file uses the same real STEP fixture and creates fresh jobs and query clients. Only immutable input bytes are shared within a file. The varied-board workflow generates through the page once; kernel and worker tests retain direct output checks.

The Boards and Plan route tests put `src/test/camWorkerCache.ts` in front of the CAM worker (`wrapCamWorker`). Within a test file, a model with the same bytes is read once and a board with the same request and settings is planned once, so each test opens its new job without reading and planning it again, and picks up the plans the test before it started instead of queueing behind them. The results are the real worker's from that run, so the route assertions still see real CAM output. Pipeline checks that don't need the page go in Node: `src/cam/importedModel.ts` is the worker's import, usable there with `loadStep`, and `src/cam/variedBoards.test.ts` checks holds and plans for every varied-board model, while the route test shows one held and one blocked board.

## Waiting in browser tests

A browser test waits for the app with `await settled()` from `apps/camNC/src/test/settled.ts`, after rendering and after each input, then checks the result directly. It waits on the settled signal the behaviour specs use (`src/lib/settled.ts`, see [Settling](../apps/camNC/e2e/spec/README.md#settling)): solver and CAM worker calls, saves, queries, assistant turns and 3D views not yet drawn, plus elements marked `aria-busy` and closing menus' animations, until none is pending on two frames in a row. After a bounded timeout (10 s by default) it fails naming what is still pending, such as `still pending: render 1`. Mark a test's own react-three-fiber canvas with `{...settledCanvas}` so its first frame counts, and pass a test's own `QueryClient` to `trackQueryClient`. The signal is reset after each test.

Don't add sleeps or one-off polls for readiness. Keep a specific wait only for what the signal can't see, with a comment saying why: a lazily loaded view before its module arrives (wait for its canvas or its props), or a mocked component's props.

## Scheduling and cache correctness

A pull request runs only the checks, the `headless` entry (which also runs the browser test files the PR adds or edits, up to 20) and the simulator tests, a few minutes in all. The simulator tests run only when the PR touches `packages/fluidnc`, the lockfile or `.github`. The browser shards and the behaviour specs run in the Mergify merge queue, once for a batch of up to three PRs. So run the browser files and scenarios your change touches locally before queueing, or add the `full-ci` label: from the PR's next push, it runs everything there too, and the label comes off once a CI run passes (`.github/workflows/full-ci-label.yml`). A browser failure in the queue drops the PR from its batch, and the other PRs are tested again without it.

CI's `test` matrix has four runners. The `headless` entry runs every package's `test` task (CAD, CAM, OpenCV and the rest) and the app's domain, worker and license tasks in one Turbo invocation, one task at a time, then both performance gates. Those suites take seconds each, while a runner's setup takes about two minutes, so one entry costs less than one per suite. The browser files get the other three runners, as three Vitest shards, so the browser suite, CAD/WASM and OpenCV never compete for one runner's CPUs. CI runs every behaviour scenario across four deterministic shards balanced by measured duration. Scenario IDs break assignment ties. Golden updates remain unsharded. Unit tests exercise the actual scenario corpus to prove complete, duplicate-free assignment. New files/scenarios receive a conservative fallback estimate and are always assigned. Long scenarios start immediately after the first warmup scenario. The duration weights record their source CI run and can be refreshed from timing artifacts; they only affect scheduling, never selection. Runtime allocation and performance-gate wiring are checked by `test:ci`.

The required check stays named **Run tests**. It waits for all test/spec matrix entries, static validation, builds, and simulator integration, and fails on failed, cancelled, or unexpectedly skipped dependencies. No correctness tests were moved to a nightly-only lane.

Domain, worker, license, browser and behaviour tasks have independent Turbo entries. The root full/fast commands use these entries rather than the combined app script. The app's `pnpm test` remains a complete standalone command. Source dependencies flow through Turbo transit nodes; package/lockfile changes invalidate relevant work. Worker tasks hash worker sources and migrations. Browser/spec tasks default to all app inputs, excluding only worker sources and migrations. New app files invalidate them automatically. The new headless workspace packages provide genuinely independent source/cache boundaries.

Use the cached `spec:cad` task for local-source validation. Run production/external-URL smoke scripts directly; external deployment state is not a source cache input. Browser correctness shards cache independently because their CLI arguments are part of the Turbo task hash. Performance gates execute directly and are never replayed from the functional cache.

### Dependency cache

Every CI job installs through `.github/actions/install-dependencies`, which restores one pnpm store entry keyed by `pnpm-lock.yaml`. Only the checks job on a push to main saves it, when no entry matches the lockfile yet; PR and queue-batch jobs read main's entry and save nothing, so no post-job cache upload delays the required check. A PR that changes the lockfile restores the closest older store and downloads only the missing packages. The store lives in the ignored `.pnpm-store` directory of the workspace, and the action hides zstd from its cache steps, because the Playwright container has no zstd and a cache entry restores only with the compression that saved it.

### Mergify merge queue

Mergify runs the merge queue for `main` (`.mergify.yml`). Queue a ready PR by labelling it `ready` (it queues once **Run tests** passes, even if its author is away), with `@mergifyio queue`, or tick "Queue this pull request" in Mergify's comment, and remove it with `@mergifyio dequeue`. Passing CI alone does not queue a PR without the label, and GitHub's auto-merge button does not queue it either. The queue requires the original PR's **Run tests** check, inherits GitHub's required checks and reviews, and requires **Run tests** plus every browser and spec shard check on the combined candidate. It squash-merges each PR.

Mergify groups up to three PRs per batch, waiting at most 30 seconds for a batch to fill, and checks one batch at a time: a batch takes 11 jobs, and two of them next to PR CI overran the 20 concurrent jobs the plan allows. A `flaky-test` PR interrupts the running batch to be tested first; other `ci-fix` PRs go to the front without interrupting it. A failed batch is split to find the PR at fault; automatic check retries stay disabled. The browser and spec merge conditions force full validation of the candidate even when the original PR is already up to date with main.

Batch candidates are temporary draft PRs with heads under `mergify/merge-queue/` targeting `main`. The `pull_request` trigger runs every validation job for them, and the **Run tests** gate rejects skipped browser or spec jobs there. Keep draft PRs enabled and add no head-branch exclusions. Main pushes keep the static and build cache warming; squash merges do not preserve the candidate SHA, but Turbo cache keys depend on task inputs.

The flaky-test reporter files a failed batch only once a later batch passes with each of its PRs at the same commit, so a failure that a fix resolved is not reported. A failed attempt that a rerun fixed is reported too.

The `main` ruleset keeps the required **Run tests** check, the review rules and the allowed merge methods, with Mergify as a bypass actor. **Require branches to be up to date** stays off: the queue tests the combined candidate instead of updating each branch.

### Shared CI cache setup

The static/build, test and behaviour jobs exchange GitHub OIDC identities for short-lived, cache-only Vercel tokens. No long-lived `TURBO_TOKEN` secret is needed. Configure repository variable `TURBO_TEAM` with the Vercel team slug and, optionally, `TURBO_POLICY_ID` to select a specific policy. Without `TURBO_TEAM`, authentication is skipped and existing per-suite GitHub cache snapshots remain available.

Create a Turborepo CLI policy in the team's **Settings → Build and Deployment → OIDC Policies** with issuer `https://token.actions.githubusercontent.com` and audience `https://vercel.com/camnc-ci-cache`. Restrict it to repository ID `941977139`, owner ID `318181168`, and workflow `CI`. These exact claims cover PR, main and temporary merge-queue refs without a subject wildcard; the immutable IDs prevent an unrelated repository taking over a reused name. The policy grants remote-cache access, not deployment or account-management access.

Only the three Turbo job groups request `id-token: write`. Their authentication step skips fork PRs, which continue using the local cache. Do not expose cache write credentials through `pull_request_target` or execute untrusted fork code with cache credentials.

Keep main-push validation, which warms the default-branch snapshots, until remote reuse is verified. Before changing that policy, compare task hashes and actual hit rates on representative PR and merge-group runs, and confirm that dependency edits invalidate the affected tasks. Never cache performance-gate execution.

## Measuring changes

CI always uploads test timing reports and behaviour results, including restored reports on cache hits. Vitest reports distinguish file collection, setup, preparation and test/hook time from wall time; summed file times are not parallel wall time. Behaviour results include bootstrap and complete scenario duration. Reports go under each package's ignored `test-results` directory.

Compare cold and warm runs separately. Record source SHA, cache hits, slowest files/scenarios, per-job duration, queue delay, end-to-end required-check duration, and total runner-minutes. Compare representative UI-only, CAD, CAM, worker and documentation changes. Repeat timings before claiming a p95 or a fixed percentage improvement. Cache-hit reports describe the original execution; the current CI step duration shows replay cost.

The first two-shard CI trial passed all 148 scenarios but still left the slower spec lane at about six minutes. The four-shard spec matrix and duration-based browser allocation address that measured tail.

The initial targets are under one minute for ordinary local feedback and under five minutes for typical PR validation. These are acceptance targets, not guaranteed timings. Measure every browser lane: shortening one does not help the required-check time if another still dominates. More shards must justify their runner-minutes and setup overhead.

The incremental hold-timeline algorithm remains a separate product/safety change. It requires independent invariants and differential checks against the existing implementation, and is not needed to adopt these test boundaries.
