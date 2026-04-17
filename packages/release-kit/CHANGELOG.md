# Changelog

All notable changes to this project will be documented in this file.

## [release-kit-v4.8.0] - 2026-04-17

### Bug fixes

- Replace broad catch with `existsSync` guard in `detectRepoType` (#229)

  Fixes silent swallowing of unexpected filesystem errors in `detectRepoType`. Previously, errors like `EACCES` (permission denied) or `EMFILE` (too many open files) when reading `package.json` were caught and discarded, causing the function to silently return `'single-package'` instead of surfacing the problem.

### Features

- Add `push` command for safe tag pushing (#243)

  Adds a `release-kit push` command that safely pushes the release commit and each tag individually, ensuring GitHub Actions fires a separate workflow run per tag. The command performs a `1 + N` push sequence: one branch push followed by one `git push --no-follow-tags origin <tag>` per resolved tag. Supports `--dry-run` (preview without pushing), `--only` (filter tags by package name), and `--tags-only` (skip the branch push).

## [release-kit-v4.7.0] - 2026-04-16

### Features

- Support ## as synthetic ticket prefix in changelogs

  Commits prefixed with `##` are now included in changelogs without requiring a ticket ID. This supports ad-hoc changes made during interactive sessions where creating a ticket and PR adds undesired overhead.

## [release-kit-v4.6.0] - 2026-04-15

### Features

- Guard `prepare` against dirty working tree (#188)

  Add a clean-working-tree check at the start of `prepareCommand` that exits with an error when `git status --porcelain` reports uncommitted changes. This prevents the double-bump problem where running `prepare` multiple times bumps the version each time from the already-bumped `package.json`.

  The check can be bypassed with `--no-git-checks` (`-n`) and is automatically skipped during `--dry-run`.

- Add sync-labels drift detection to release-kit readyup kit (#190)

  Adds readyup kit checks that detect when a consumer's sync-labels workflow or generated labels file has drifted from the current templates and presets. The `generate` command now embeds per-preset content hashes in the `labels.yaml` header, enabling hash-based staleness detection.

- Improve changelog formatting & add cliff config drift detection (#193)

  Improves changelog generation: cleanly indented commit bodies, stripped type prefixes, and no unticketed noise. Adds hash-based drift detection so the rdy kit warns when a consumer's local cliff config falls behind the current template. Fixes a latent bug where git-cliff rejected the bundled `.template` file extension.

- Generate release notes distinct from changelogs (#199)

  Adds structured changelog generation with audience tagging to the `release-kit` package, enabling GitHub Release creation and npm README injection with user-facing release notes filtered from developer-only sections. The existing CHANGELOG.md pipeline is unchanged; a new `.meta/changelog.json` artifact is generated in parallel during `release-kit prepare`, and consumed during `release-kit publish` to create GitHub Releases and inject release notes into the published package's README.

### Refactoring

- Decouple GitHub Release creation and README injection from npm publish (#203)

  Makes GitHub Release creation available as a standalone CLI command (`release-kit github-release`) and removes README injection logic from the publish function. Non-published projects (applications, websites, internal tools) can now create GitHub Releases independently after `release-kit prepare`, and the inject/restore lifecycle is managed by the command layer rather than buried inside business logic.

### Tooling

- Enable automated publication to npm (#187)

  Prepares the repository for reliable tag-triggered npm publishing by adding missing package metadata, standardizing licensing, and introducing a readyup kit that validates publish readiness across all packages.

## [release-kit-v4.5.1] - 2026-04-10

### Bug fixes

- Fix sync-labels init scaffolding output (#179)

  Fixes three issues in `release-kit sync-labels init` scaffolding output that cause immediate errors for consumers: adds missing workflow permissions, corrects config template indentation from 2 to 4 spaces, and switches YAML quoting from double to single quotes.

## [release-kit-v4.4.0] - 2026-04-04

### Documentation

- Refine README to match preflight documentation standard (#138)

  Restructures the release-kit README to match the documentation standard established by the preflight README (#114). Reorders sections to follow the cross-package convention, converts CLI flag listings from code blocks to tables, adds representative `prepare --dry-run` output to the quick start, and condenses ~90 lines of inline workflow YAML into a summary with an inputs table and trigger examples. Fixes several accuracy gaps found by verifying documentation against source.

### Features

- Add --version flag to nmr and release-kit (#143)

  Adds `--version` / `-V` support to the `nmr` and `release-kit` CLIs, matching the existing `preflight` behavior. Moves the build-time version generation script to the shared `config/` directory so all three packages use a single `generateVersion.ts`.

- Detect and report missing build output in bin wrappers (#152)

  Adds try/catch with `ERR_MODULE_NOT_FOUND` detection to all six bin wrappers across `nmr`, `preflight`, and `release-kit`. Previously, five of the six wrappers used bare `import()` calls that produced cryptic unhandled rejections when `dist/` was missing, and `preflight`'s existing try/catch gave no actionable guidance.

### Refactoring

- Extract deleteFileIfExists helper (#136)

  Replaces the duplicate `deleteTagsFile` and `deleteSummaryFile` functions in `createTags.ts` with a single parameterized `deleteFileIfExists(path)` utility. The new helper lives in its own module and is exported from the package barrel for reuse.

- Extract shared CLI argument-parsing utility into core (#151)

  Add a schema-driven `parseArgs` function to `@williamthorsen/node-monorepo-core` that handles boolean flags, string flags (both `--flag=value` and `--flag value`), short aliases, positional collection, the `--` delimiter, and unknown-flag errors. Migrate all CLI argument-parsing sites in preflight (3 sites) and release-kit (5 sites) to use it. A companion `translateParseError` helper normalizes internal error messages for consistent user-facing output.

## [release-kit-v4.0.0] - 2026-04-02

### Features

- Rename reusable workflows to .reusable.yaml convention (#129)

  Renames all three reusable GitHub Actions workflow files from the inconsistent `-workflow.yaml`/bare `.yaml` convention to a uniform `.reusable.yaml` suffix. Updates all references across caller workflows, release-kit templates, tests, preflight collection, and documentation. Scaffolds the sync-labels caller workflow and labels file for this repo. Deletes superseded legacy files.

## [release-kit-v3.0.0] - 2026-03-29

### Bug fixes

- Pass tag pattern to git-cliff based on tagPrefix (#77)

  Fixes the issue that git-cliff was processing the entire commit history on every run instead of only commits since the last release.

  Constructs the pattern from `tagPrefix` at invocation time (e.g., `release-kit-v` → `release-kit-v[0-9].*`) and pass it via `--tag-pattern`, which overrides the config file default.

- Propagate version bumps to workspace dependents (#80)

  Restructures `releasePrepareMono` from a single-pass loop into a phased pipeline that automatically patch-bumps workspace dependents when a component is released. A reverse dependency graph is built from `workspace:` references in `dependencies` and `peerDependencies`, then BFS propagation walks upward from bumped components to their dependents. Propagated-only components receive synthetic changelog entries instead of git-cliff invocations.

### Features

- Support conventional-commit format in commit parsing (#85)

  Adds support for the conventional commits format (`type(scope): description`) alongside the existing pipe-prefixed format (`scope|type: description`) in release-kit's commit parser. Renames `workspace` to `scope` throughout release-kit types, config, validation, and consumers.

- Add commit command for local release flow (#89)

  Adds a `release-kit commit` command that centralizes the release commit step between `prepare` and `tag`. The command reads tag names and a per-component commit summary from temporary files written by `prepare`, stages all changes, and creates a formatted commit. Two new utilities — `stripScope` and `buildReleaseSummary` — support building the commit body by stripping redundant scope indicators and formatting commits under their component headings. The CI workflow is simplified to use `release-kit commit` and `release-kit tag` instead of inline shell logic.

- Add CI publish workflow with OIDC trusted publishing (#90)

  Adds automated npm publication via a tag-push-triggered GitHub Actions workflow using OIDC trusted publishing. Extends `release-kit publish` with a `--provenance` flag and `release-kit init` with publish workflow scaffolding.

- Make --provenance opt-in to support private repos (#94)

  Adds a `provenance` boolean input (default `false`) to the reusable `publish-workflow.yaml` so private repos using OIDC trusted publishing no longer fail at publish time. The `--provenance` flag is only passed to `release-kit publish` when the caller sets `provenance: true`.

  Updates the scaffolded `publish.yaml` template to include `provenance: false` with an inline comment guiding public repos to opt in. Expand the `release-kit init` next-steps output with hints about the provenance setting and trusted publisher registration. Set `provenance: true` in this repo's own `publish.yaml` since it is public.

## [release-kit-v2.3.2] - 2026-03-28

### Bug fixes

- Prevent unparseable commits from being silently dropped (#76)

  Prevents `releasePrepareMono` and `releasePrepare` from silently skipping components whose commits have unparseable messages. Adds ticket-prefix stripping to `parseCommitMessage` (mirroring cliff.toml's `commit_preprocessors`), a patch-floor safety net when commits exist but none parse, and unparseable-commit reporting in `reportPrepare`.

## [release-kit-v2.3.0] - 2026-03-28

### Features

- Add shared writeFileWithCheck utility and overwrite reporting (#66)

  Extracts three duplicated `writeIfAbsent` implementations and two duplicated terminal helper sets into shared utilities in `@williamthorsen/node-monorepo-core`, then migrates all consumers (`release-kit init`, `preflight init`, `sync-labels`) to use them. All init commands now report which files were created, overwritten, skipped, or failed — including when `--force` replaces existing files.

- Separate tag-write errors from release preparation errors (#67)

  When tag-file writing fails, the error message now reads "Error writing release tags:" instead of the misleading "Error preparing release:", which only appeared because both operations shared a single try/catch.

  Refactors `writeReleaseTags` to use the shared `writeFileWithCheck` utility from `@node-monorepo-tools/core` instead of raw `mkdirSync`/`writeFileSync`. The function now returns a structured `WriteResult` instead of throwing, and contains no `console` calls — all presentation moves to `runAndReport`.

### Tests

- Add eligibility check failure and short-circuit tests (#63)

  Adds 4 unit tests to `initCommand.unit.test.ts` covering the remaining `checkEligibility` orchestration gaps: individual failure exit codes for `hasPackageJson` and `usesPnpm`, and short-circuit verification ensuring downstream checks are skipped when an earlier check fails.

- Add cliff.toml.template alignment test (#64)

  Adds a unit test that enforces bidirectional alignment between `DEFAULT_WORK_TYPES` and the bundled `cliff.toml.template` commit parsers. The test parses the TOML template using `smol-toml`, then verifies that every canonical type name and alias is matched by a parser with the correct group heading, and that every parser group maps to a known work type header.

- Add releasePrepare coverage for bumpOverride, tagPrefix, and dry-run tags (#65)

  Adds three unit tests to `releasePrepare.unit.test.ts` covering previously untested code paths: the `bumpOverride` bypass of commit-based bump detection, custom `tagPrefix` propagation into tags, and tag computation in dry-run mode.

## [release-kit-v2.2.0] - 2026-03-27

### Features

- Add sync-labels command (#33)

  Add a `release-kit sync-labels` command group with three subcommands (`init`, `generate`, `sync`) for declarative GitHub label management in monorepos. Bundle a reusable GitHub Actions workflow and composable label presets with the release-kit package. Introduce a `findPackageRoot` utility to replace fragile hardcoded path resolutions across the codebase.

- Report up-to-date status for unchanged init files (#35)

  `release-kit init` now compares existing file content against the default before reporting status. When an existing file is identical to the default (after normalizing trailing whitespace), it reports `✅ (up to date)` instead of the misleading `⚠️ (already exists)`.

- Auto-detect Prettier for CHANGELOG formatting (#36)

  When `formatCommand` is not configured, release-kit now auto-detects whether the repo uses Prettier by checking for config files (`.prettierrc*`, `prettier.config.*`) or a `"prettier"` key in root `package.json`. If found, it defaults to `npx prettier --write` on generated files. If not found, formatting is skipped.

- Add tag-creation command (#40)

  Adds a `release-kit tag` CLI command that reads computed tag names from the `tmp/.release-tags` file produced by `prepare` and creates annotated git tags. The command supports `--dry-run` (preview without creating tags) and `--no-git-checks` (skip dirty working tree validation). The `createTags` function and its options type are exported for programmatic use.

- Add publish command (#42)

  Adds a `release-kit publish` subcommand that derives packages to publish from git tags on HEAD and delegates to the repo's detected package manager. Also cleans up the `.release-tags` file after tag creation.

- Remove tagPrefix customization from component config (#49)

  Removes the ability to customize `tagPrefix` per component, enforcing the deterministic `{dir}-v` convention universally. The internal `tagPrefix` property on `ComponentConfig` and `ReleaseConfig` is preserved — only the override/customization entry points are removed. Existing configs that still include `tagPrefix` now receive a clear deprecation error.

- Add styled terminal output to prepare command (#55)

  Adds ANSI formatting and emoji markers to the `release-kit prepare` command output. Progress chatter is dimmed, key results (version bumps, release tags, completion status) are highlighted with bold text and emoji, and monorepo components are separated by box-drawing section headers.

- Extract nmr CLI from core package (#61)

  Extracts all nmr CLI code from `packages/core` into a new `packages/nmr` package (`@williamthorsen/nmr`). Core is reduced to an empty shared-library shell ready for cross-cutting utilities. All internal references are rewired and the full build/test pipeline passes.

  Scopes: core, nmr

### Refactoring

- Replace dist bin targets with thin wrapper scripts (#48)

  The `bin` entries in `packages/core` and `packages/release-kit` pointed directly into `dist/esm/`, causing `pnpm install` to emit "Failed to create bin" warnings in fresh worktrees where `dist/` does not yet exist. Each bin entry now points to a committed wrapper script in `bin/` that dynamically imports the real entry point. The `files` field in both packages includes `bin` so the wrappers are published.

- Separate presentation from logic in prepare workflow (#57)

  Extracts all `console.info` calls from the prepare workflow's logic functions (`bumpAllVersions`, `generateChangelogs`, `releasePrepare`, `releasePrepareMono`) into a dedicated `reportPrepare` formatter. Logic functions now return structured result types (`BumpResult`, `ComponentPrepareResult`, `PrepareResult`). The legacy `runReleasePrepare` entry point is retired, with its utilities absorbed into `prepareCommand`.

### Tests

- Cover multi-changelogPaths and error paths (#44)

  Add three tests for previously untested code paths:
  - `releasePrepareMono`: component with two `changelogPaths` entries, asserting `git-cliff` is invoked once per path with the correct `--output` target.
  - `getCommitsSinceTarget`: `git describe` failure with a non-128 exit status propagates as a wrapped error instead of being swallowed.
  - `getCommitsSinceTarget`: `git log` failure is wrapped and re-thrown with the commit range in the message.

  Also adds a `findAllCliffOutputPaths()` test helper that collects the `--output` arg from every `git-cliff` mock call.

### Tooling

- Adopt nmr to run monorepo and workspace scripts (#38)

  Replaces the legacy workspace script runner and ~25 root `package.json` scripts with `nmr`, the monorepo's own context-aware script runner. Root scripts are reduced to 4 (`prepare`, `postinstall`, `ci`, `bootstrap`), packages use direct build commands for bootstrap, and release-kit declares tier-3 test overrides for its integration test configs.

## [release-kit-v2.1.0] - 2026-03-17

### Features

- Migrate release-kit from toolbelt (#18)

  Migrates the complete `@williamthorsen/release-kit` package (v1.0.1) from `williamthorsen/toolbelt` into `packages/release-kit/`, adds shebang preservation to the shared esbuild plugin for CLI binaries, and sets up dogfooding infrastructure so this monorepo uses release-kit for its own releases.

- Slim down release workflow by removing unnecessary pnpm install (#21)

  Make release-kit self-contained by invoking git-cliff via `npx --yes` instead of requiring it on PATH, and by appending modified file paths to the format command so lightweight formatters like `npx prettier --write` work without a full `pnpm install`. Update init templates, README, and consuming repo config/workflow to reference workflow v3.

- Add --force flag to release-kit prepare (#25)

  Add a `--force` flag to `release-kit prepare` that bypasses the "no commits since last tag" check in monorepo mode, allowing version bumping and changelog generation to proceed even when no new commits are found since the last release tag. The flag requires `--bump` since there are no commits to infer bump type from. The local release workflow gains a `force` boolean input for future use.

- Move reusable release workflow into repo (#26)

  Moves the reusable release workflow from `williamthorsen/.github` into this repo as `release-workflow.yaml`, stripping all pnpm-related steps since release-kit now runs git-cliff and prettier via `npx` internally. Updates this repo's caller workflow to use a relative path and update init templates to reference the new location. Establishes a naming convention (`{name}-workflow.yaml` for reusable, `{name}.yaml` for callers) and independent versioning strategy (`{name}-workflow-v{major}` tags), documented in `.github/workflows/README.md`.

- Allow git-cliff to be used without config (#31)

  Adds a `resolveCliffConfigPath()` function that searches for a git-cliff config in a 4-step cascade (explicit path → `.config/git-cliff.toml` → `cliff.toml` → bundled `cliff.toml.template`), eliminating the requirement for consuming repos to maintain a cliff config copy. Restructures the `init` command to scaffold only the workflow file by default, with new `--with-config` and `--force` flags. Moves `.release-tags` from `/tmp/release-kit/` to project-local `tmp/` for predictable behavior in local runs.

### Refactoring

- Clean up release-kit post-migration issues (#19)

  Addresses five code quality issues and a test coverage gap identified during the release-kit migration (#5). Extracts a duplicated `isRecord` type guard into a shared module, eliminates a double-read in `bumpAllVersions`, improves error handling in `usesPnpm` by replacing a silent catch with a structured error boundary, removes an unreachable `'feature'` pattern from version defaults, and adds an integration test for scaffold template path resolution.

<!-- generated by git-cliff -->
