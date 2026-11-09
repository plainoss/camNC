# Guidelines for Coding Agents

This repository is a pnpm/Turborepo workspace using TypeScript and React.

## Workflow

- Use **pnpm** (Node `^20.19` or `>=22.12`, see `.nvmrc`) for all package management tasks.
- Only in cloud environments: After making changes, run `pnpm run lint`, `pnpm run check-types`, `pnpm run test` and `pnpm run build` from the repo root.
  - These commands execute turborepo tasks across all packages.
- Formatting is automated — you do **not** need to run the formatter manually:
  - A `pre-commit` git hook (simple-git-hooks + nano-staged) re-formats staged `.ts`/`.tsx` files with Biome and `.md` files with Prettier on every commit.
  - It reuses the repo `biome.json` and `.prettierrc`/`.prettierignore`, so the result always matches CI's `pnpm run check-format`.
  - To keep a hand-aligned block (a matrix, a table of numbers), put `// biome-ignore format: <why>` above it.
  - The hook installs itself via the `prepare` script on `pnpm install`.
- Keep generated files such as `routeTree.gen.ts` read-only; avoid editing them manually.
- Keep external application comparison reports, captures and private document links in the private companion repository. Public documentation and examples describe application behavior without product comparisons.
- Public tests and scripts must work without private reference files.
- For Part Studio feature work, use the core and interface lanes in `docs/CAD_ITERATION.md`: `pnpm --silent cad:iterate` and `pnpm --silent cad:iterate:ui`. Preserve a complete woodworking workflow alongside reduced diagnostics. Established reference behavior is the default for feature semantics and UI details; consult the private companion's reference contracts and record missing evidence explicitly.
- During long-running branch work, commit and push meaningful milestones and at least every two hours as a backup.
- Pick work from the known gaps in `docs/STATUS.md`. It is generated: edit its sources (scenarios, `docs/status-checklist.json`), run `pnpm run status` and commit the result; CI fails when it is stale or a domain's passing specs drop below their floor.

## Dev Environment Tips

- Use `pnpm dlx turbo run where <project_name>` to locate a package quickly.
- Run `pnpm install --filter <project_name>` when adding a package so local tools see it.
- Use `pnpm create vite@latest <project_name> -- --template react-ts` to start a new React + Vite package.
- Confirm each package's `package.json` has the correct `name` field (ignore the top-level one).

## Testing Instructions

- The CI workflow lives in `.github/workflows`.
- Run `pnpm turbo run test --filter <project_name>` to execute checks for a single package.
- `pnpm run test` replays packages whose files (and workspace dependencies) didn't change from a cache shared by every worktree of the checkout, so a full run after a small change only tests what it touched. Run it from the repo root rather than calling `turbo run test` directly, which uses a per-worktree cache.
- On a local machine, agents run `pnpm run test:fast` plus any test files for the code they changed, and leave the full run to CI. It runs the headless packages, app domain and worker tests, and skips camNC's slow browser files (`apps/camNC/vitest.fast-excludes.json`) and the performance gates; name a skipped file to run it, e.g. `pnpm vitest run boards` in `apps/camNC`.
- `pnpm run test` and `pnpm run test:fast` share a lock in the git common dir, so broad runs from different worktrees wait for each other instead of competing into timeouts. Do not bypass the lock or start another broad suite while waiting; run the changed test files directly for immediate feedback.
- From within a package you can run `pnpm test`.
- Focus on one test with `pnpm vitest run -t "<test name>"`.
- Tests run in headless Chromium (Vitest browser mode); install it once with `pnpm exec playwright install chromium`.
- Reproduce Part Studio and CAM issues headlessly before opening a browser: run a saved design (Save to file) through `pnpm --silent --filter @wbcnc/cad-script check --from design.json --report full`, and keep it as a golden report in `packages/cad-script/fixtures/designs/` (see `packages/cad-script/README.md`).
- To try sketch editor behaviour in a real browser without replaying a whole scenario, use the interactive session in `apps/camNC/e2e/spec/README.md`.
- Fix failing tests or type errors until the suite passes.
- After moving files or changing imports, run `pnpm lint --filter <project_name>`.
- Always add or update tests for the code you change.
- A crash fix comes with the failing seed or input as a regression test. The seeded fuzz tests of `@wbcnc/cad` (`parseFuzz`) and `@wbcnc/cad-editor` (`commandFuzz`) print both on failure; `FUZZ_SEED=<n>` replays one seed and `FUZZ_SEEDS=<n>` runs seeds 1..n.

## Iteration and CI failures

- During development, run the changed tests and relevant package lint/type checks first. `pnpm run check-types` type-checks every package with TypeScript 7's native `tsc` in about 12 s, the same check CI runs. Run the local fast suite once the change is ready, plus affected files excluded from it. After rebasing or resolving conflicts, rerun affected checks and `pnpm run check-format` before pushing; a previous green run validates the previous tree.
- PR CI runs only the quick suites. The browser files and behaviour specs run in the merge queue, so run the ones your change touches locally before queueing, or label the PR `full-ci` to run them on the PR (docs/TESTING.md).
- Report only what ran: in PRs and replies, say which checks and tests you ran and which you couldn't. A local pass is not CI, and a test you didn't run is not evidence.
- Push coherent, validated milestones. Superseded PR commits cancel their CI, so avoid repeated pushes of incomplete fixes that discard useful validation.
- Before repairing a shared test driver or CI failure, inspect open PRs and current main for an existing fix. Coordinate one shared repair rather than independently patching it into several feature branches.
- Claim a shared failure before fixing it: comment on its open `flaky-test` issue (CI files one when a test fails and then passes on the same code), or open one if there is none, with the `flaky-test` label and a title CI would give it, so later flakes land on it: `Flaky test: ` and then the spec (`sketch/machine/edit-after-cut-keeps-boards`) or `file > describe > test`, and link your PR there. If someone already claimed it, wait for their fix or help on their PR.
- Read the failing assertion and its artifacts before classifying a failure as transient. A local pass does not establish that CI is flaky. Retry failed jobs only on the same candidate when there is evidence of a transient failure; if the same assertion fails again, investigate and repair its cause instead of repeatedly requeuing unchanged code.
- For asynchronous UI tests, wait for the specific observable readiness condition before acting or asserting. Preserve the expected result; do not replace assertions with fixed sleeps or blanket retries.

## Commit Messages

- Follow the Conventional Commits style (`feat(<project_name>):`, `fix(<project_name>):`, `chore(<project_name>):`, `docs(<project_name>):` etc.).
- Write concise summaries in the imperative mood (e.g. "fix: update worker config").

## Pull Requests

- Title format: `feat/fix/chore/docs(<project_name>) <Title>`
- Open reviewable dependent PRs as soon as their work is ready; distinguish a dependency blocking merge from one blocking review or initial validation. State the dependency and base explicitly, and account for the workflow's target-branch triggers when deciding which checks can run before retargeting.
- Keep CI and workflow changes out of feature PRs. If a feature needs one, open a separate PR (or an issue) for it, so the change gets its own review and can be reverted alone.
- When asked to merge, queue the PR in Mergify (see `docs/TESTING.md`): tick "Queue this pull request" in Mergify's comment on the PR, or comment `@mergifyio queue`, then check that the "Mergify Merge Queue" check shows it queued. Don't use GitHub auto-merge. Continue monitoring until it merges or a concrete blocker needs action. After a queue rejection, inspect the reason and current candidate, address it, and requeue when appropriate; a retry of an obsolete candidate does not validate a new one.
- Do not routinely rebase a healthy queued PR just because main advanced; the queue validates the combined candidate. Update the branch when resolving an actual conflict or incorporating a required fix, then validate the changed tree.

## Code Style

- All source code is written in modern ES modules and TypeScript.
- Lint with `pnpm run lint` (oxlint, configured in `.oxlintrc.json`; a whole run takes a few seconds).
- Do not commit build artifacts or `node_modules` directories.
- Put a new tool, feature or dialog in its own module rather than growing an existing file. Shared files (the CAD editor component, routes, registries) get only small, surgical edits that wire the new module in.
- Other agents edit the same shared files in parallel: re-read a shared file just before you edit it, not from memory of an earlier read.
- A check that looks removable (a guard, a readiness wait, an odd condition) carries a comment saying what it prevents. Read that comment before changing or removing it, and write one when you add such a check.
- `scripts/file-size-ratchet.mjs` caps source files at 1000 lines, at commit and in CI. Files that were already longer are listed in `scripts/file-size-ceilings.json` and may only shrink; when one outgrows its cap, move code into a new module (nothing raises a ceiling).
- After a refactor shrinks a listed file, run `node scripts/file-size-ratchet.mjs --update` to lower its ceiling (or drop it once it fits) and commit the result.
