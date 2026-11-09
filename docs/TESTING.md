# Test architecture and CI feedback

Run `pnpm run test:fast` for local feedback, plus any slow browser files changed by the work. Run `pnpm run test:ci` after changing task allocation, cache inputs, or workflows. CI runs the complete corpus and isolated performance gates; the fast subset never counts as a full result.

During an edit, run focused test files directly. Both root broad commands (`test` and `test:fast`) acquire the same local worktree lock; CI skips that lock because each suite has its own runner. Waiting for a broad suite does not prevent focused checks. This avoids concurrent agents repeatedly timing out otherwise passing browser tests.

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

## Scheduling and cache correctness

A pull request runs only the checks, the `headless` entry and the simulator tests, a few minutes in all. The browser shards and the behaviour specs run in the merge queue, once for a batch of up to three PRs (the queue waits up to five minutes to form a pair). So run the browser files and scenarios your change touches locally before queueing, or add the `full-ci` label: from the PR's next push, it runs everything there too. A browser failure in the queue drops the PR from its batch, and the other PRs are tested again without it.

CI's `test` matrix has three runners. The `headless` entry runs every package's `test` task (CAD, CAM, OpenCV and the rest) and the app's domain, worker and license tasks in one Turbo invocation, one task at a time, then both performance gates. Those suites take seconds each, while a runner's setup takes about two minutes, so one entry costs less than one per suite. The browser files get the other two runners, as two Vitest shards, so the browser suite, CAD/WASM and OpenCV never compete for one runner's CPUs. CI runs every behaviour scenario across four deterministic shards balanced by measured duration. Scenario IDs break assignment ties. Golden updates remain unsharded. Unit tests exercise the actual scenario corpus to prove complete, duplicate-free assignment. New files/scenarios receive a conservative fallback estimate and are always assigned. Long scenarios start immediately after the first warmup scenario. The duration weights record their source CI run and can be refreshed from timing artifacts; they only affect scheduling, never selection. Runtime allocation and performance-gate wiring are checked by `test:ci`.

The required check stays named **Run tests**. It waits for all test/spec matrix entries, static validation, builds, and simulator integration, and fails on failed, cancelled, or unexpectedly skipped dependencies. No correctness tests were moved to a nightly-only lane.

Domain, worker, license, browser and behaviour tasks have independent Turbo entries. The root full/fast commands use these entries rather than the combined app script. The app's `pnpm test` remains a complete standalone command. Source dependencies flow through Turbo transit nodes; package/lockfile changes invalidate relevant work. Worker tasks hash worker sources and migrations. Browser/spec tasks default to all app inputs, excluding only worker sources and migrations. New app files invalidate them automatically. The new headless workspace packages provide genuinely independent source/cache boundaries.

Use the cached `spec:cad` task for local-source validation. Run production/external-URL smoke scripts directly; external deployment state is not a source cache input. Browser correctness shards cache independently because their CLI arguments are part of the Turbo task hash. Performance gates execute directly and are never replayed from the functional cache.

### Dependency cache

Every CI job installs through `.github/actions/install-dependencies`, which restores one pnpm store entry keyed by `pnpm-lock.yaml`. Only the checks job on a push to main saves it, when no entry matches the lockfile yet; PR and merge-queue jobs read main's entry and save nothing, so no post-job cache upload delays the required check. A PR that changes the lockfile restores the closest older store and downloads only the missing packages. The store lives in the ignored `.pnpm-store` directory of the workspace, and the action hides zstd from its cache steps, because the Playwright container has no zstd and a cache entry restores only with the compression that saved it.

### Mergify merge queue

The root `.mergify.yml` defines an opt-in queue for `main`: queue a ready PR with `@mergifyio queue` and remove it with `@mergifyio dequeue`. Passing CI alone does not queue a PR. The queue requires the original PR's **Run tests** check, inherits GitHub's required checks and reviews, and requires **Run tests** plus all browser/spec shard checks on its combined candidate. It preserves squash merges and individual PR history.

Mergify groups up to three PRs per batch, waiting at most 30 seconds for a batch to fill, and checks up to two cumulative batches speculatively. This shares queue validation across PRs while bounding runner demand. Failed batches are split to isolate the problem; automatic check retries remain disabled. Ordinary PRs retain the lighter checks on main; `full-ci` opts a PR into browser/spec validation. The distinct browser/spec merge conditions force full candidate validation even if the original PR is already up to date. The intended saving is fewer queue validation runs per merged PR, rather than reduced test coverage.

Batch candidates are temporary draft PRs with heads under `mergify/merge-queue/` targeting `main`. The `pull_request` trigger and queue-aware job conditions run every validation job for them, including the aggregate **Run tests** check. That gate rejects skipped browser/spec jobs on Mergify batch PRs. Keep draft PRs enabled and do not add head-branch exclusions. The `merge_group` trigger remains for GitHub's queue during migration and rollback. Main pushes retain static/build cache warming; squash merges do not preserve the candidate SHA, but Turbo cache keys depend on task inputs.

Repository configuration alone does not activate the service. Roll out using the [Mergify setup guide](https://docs.mergify.com/merge-queue/setup/) and [GitHub queue migration guide](https://docs.mergify.com/migrate/github-merge-queue/):

1. Install the [Mergify GitHub App](https://github.com/apps/mergify/installations/new) for this repository and enable its Merge Queue product in the Mergify dashboard. Merge this configuration through the existing GitHub queue first.
2. In the `main` ruleset, retain the required **Run tests** check from GitHub Actions, review requirements, and allowed merge methods. Keep **Require branches to be up to date before merging** disabled: the queue tests the combined candidate instead of updating each original branch.
3. For a pilot, add Mergify as a bypass actor with **Exempt** mode on the ruleset carrying **Require merge queue**. Otherwise GitHub refuses Mergify's merges. Mergify injects the supported rules as queue requirements; audit any additional rules against [ruleset compatibility](https://docs.mergify.com/merge-queue/github-rulesets/) before granting a bypass. Keep GitHub's native queue available to other actors during the pilot.
4. Explicitly queue a low-risk PR with `@mergifyio queue`. Verify that its temporary batch PR runs every validation lane, that a failed **Run tests** blocks merging, and that the final merge is a squash. Inspect batch failures directly. The flaky-test reporter files a failed batch once a later batch passes with each of its PRs at the same commit, so a failure a fix resolved is not reported; a failed GitHub `merge_group` run counts only for jobs that also passed on the PR's own run, since PR runs skip the browser suites and specs.
5. Compare queue latency and runner-minutes per merged PR before increasing batching or concurrency. Once verified, remove **Require merge queue** from the GitHub ruleset and use Mergify for merge requests. Retain the required checks and review policy. GitHub's auto-merge button does not enqueue into Mergify; use the explicit queue command.

To roll back, stop queueing in Mergify and drain or dequeue its pending PRs. Restore GitHub's **Require merge queue** rule if removed, remove Mergify's bypass entry, and return to GitHub auto-merge. No workflow trigger change is needed.

### Shared CI cache setup

The static/build, test and behaviour jobs exchange GitHub OIDC identities for short-lived, cache-only Vercel tokens. No long-lived `TURBO_TOKEN` secret is needed. Configure repository variable `TURBO_TEAM` with the Vercel team slug and, optionally, `TURBO_POLICY_ID` to select a specific policy. Without `TURBO_TEAM`, authentication is skipped and existing per-suite GitHub cache snapshots remain available.

Create a Turborepo CLI policy in the team's **Settings → Build and Deployment → OIDC Policies** with issuer `https://token.actions.githubusercontent.com` and audience `https://vercel.com/camnc-ci-cache`. Restrict it to repository ID `941977139`, owner ID `318181168`, and workflow `CI`. These exact claims cover PR, main and temporary merge-queue refs without a subject wildcard; the immutable IDs prevent an unrelated repository taking over a reused name. The policy grants remote-cache access, not deployment or account-management access.

Only the three Turbo job groups request `id-token: write`. Their authentication step skips fork PRs, which continue using the local cache. Do not expose cache write credentials through `pull_request_target` or execute untrusted fork code with cache credentials.

Keep main-push validation, which warms the default-branch snapshots, until remote reuse is verified. Before changing that policy, compare task hashes and actual hit rates on representative PR and merge-group runs, and confirm that dependency edits invalidate the affected tasks. Never cache performance-gate execution.

## Measuring changes

CI always uploads test timing reports and behaviour results, including restored reports on cache hits. Vitest reports distinguish file collection, setup, preparation and test/hook time from wall time; summed file times are not parallel wall time. Behaviour results include bootstrap and complete scenario duration. Reports go under each package's ignored `test-results` directory.

Compare cold and warm runs separately. Record source SHA, cache hits, slowest files/scenarios, per-job duration, queue delay, end-to-end required-check duration, and total runner-minutes. Compare representative UI-only, CAD, CAM, worker and documentation changes. Repeat timings before claiming a p95 or a fixed percentage improvement. Cache-hit reports describe the original execution; the current CI step duration shows replay cost.

The first two-shard CI trial passed all 148 scenarios but still left the slower spec lane at about six minutes. The four-shard spec matrix and duration-based browser allocation address that measured tail.

The initial targets are under one minute for ordinary local feedback and under five minutes for typical PR validation. These are acceptance targets, not guaranteed timings. Measure both browser lanes: shortening one does not help the required-check time if the other still dominates. More shards must justify their runner-minutes and setup overhead.

The incremental hold-timeline algorithm remains a separate product/safety change. It requires independent invariants and differential checks against the existing implementation, and is not needed to adopt these test boundaries.
