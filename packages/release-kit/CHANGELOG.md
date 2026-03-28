# Changelog

All notable changes to this project will be documented in this file.

## [release-kit-v2.3.2] - 2026-03-28

### Bug fixes

- #71 release-kit|fix: Prevent unparseable commits from being silently dropped (#76)

Prevents `releasePrepareMono` and `releasePrepare` from silently skipping components whose commits have unparseable messages. Adds ticket-prefix stripping to `parseCommitMessage` (mirroring cliff.toml's `commit_preprocessors`), a patch-floor safety net when commits exist but none parse, and unparseable-commit reporting in `reportPrepare`.

## [release-kit-v2.3.0] - 2026-03-28

### Features

- #8 feat: Add shared writeFileWithCheck utility and overwrite reporting (#66)

Extracts three duplicated `writeIfAbsent` implementations and two duplicated terminal helper sets into shared utilities in `@williamthorsen/node-monorepo-core`, then migrates all consumers (`release-kit init`, `preflight init`, `sync-labels`) to use them. All init commands now report which files were created, overwritten, skipped, or failed — including when `--force` replaces existing files.

- #11 release-kit|feat: Separate tag-write errors from release preparation errors (#67)

When tag-file writing fails, the error message now reads "Error writing release tags:" instead of the misleading "Error preparing release:", which only appeared because both operations shared a single try/catch.

Refactors `writeReleaseTags` to use the shared `writeFileWithCheck` utility from `@node-monorepo-tools/core` instead of raw `mkdirSync`/`writeFileSync`. The function now returns a structured `WriteResult` instead of throwing, and contains no `console` calls — all presentation moves to `runAndReport`.

### Tests

- #14 release-kit|tests: Add eligibility check failure and short-circuit tests (#63)

Adds 4 unit tests to `initCommand.unit.test.ts` covering the remaining `checkEligibility` orchestration gaps: individual failure exit codes for `hasPackageJson` and `usesPnpm`, and short-circuit verification ensuring downstream checks are skipped when an earlier check fails.

- #13 release-kit|tests: Add cliff.toml.template alignment test (#64)

Adds a unit test that enforces bidirectional alignment between `DEFAULT_WORK_TYPES` and the bundled `cliff.toml.template` commit parsers. The test parses the TOML template using `smol-toml`, then verifies that every canonical type name and alias is matched by a parser with the correct group heading, and that every parser group maps to a known work type header.

- #12 release-kit|tests: Add releasePrepare coverage for bumpOverride, tagPrefix, and dry-run tags (#65)

Adds three unit tests to `releasePrepare.unit.test.ts` covering previously untested code paths: the `bumpOverride` bypass of commit-based bump detection, custom `tagPrefix` propagation into tags, and tag computation in dry-run mode.

## [release-kit-v2.2.0] - 2026-03-27

### Features

- #27 release-kit|feat: Auto-detect Prettier for CHANGELOG formatting (#36)

When `formatCommand` is not configured, release-kit now auto-detects whether the repo uses Prettier by checking for config files (`.prettierrc*`, `prettier.config.*`) or a `"prettier"` key in root `package.json`. If found, it defaults to `npx prettier --write` on generated files. If not found, formatting is skipped.

- #28 release-kit|feat: Add tag-creation command (#40)

Adds a `release-kit tag` CLI command that reads computed tag names from the `tmp/.release-tags` file produced by `prepare` and creates annotated git tags. The command supports `--dry-run` (preview without creating tags) and `--no-git-checks` (skip dirty working tree validation). The `createTags` function and its options type are exported for programmatic use.

- #29 release-kit|feat: Add publish command (#42)

Adds a `release-kit publish` subcommand that derives packages to publish from git tags on HEAD and delegates to the repo's detected package manager. Also cleans up the `.release-tags` file after tag creation.

- #41 release-kit|feat: Remove tagPrefix customization from component config (#49)

Removes the ability to customize `tagPrefix` per component, enforcing the deterministic `{dir}-v` convention universally. The internal `tagPrefix` property on `ComponentConfig` and `ReleaseConfig` is preserved — only the override/customization entry points are removed. Existing configs that still include `tagPrefix` now receive a clear deprecation error.

- #54 release-kit|feat: Add styled terminal output to prepare command (#55)

Adds ANSI formatting and emoji markers to the `release-kit prepare` command output. Progress chatter is dimmed, key results (version bumps, release tags, completion status) are highlighted with bold text and emoji, and monorepo components are separated by box-drawing section headers.

- #59 feat: Extract nmr CLI from core package (#61)

Extracts all nmr CLI code from `packages/core` into a new `packages/nmr` package (`@williamthorsen/nmr`). Core is reduced to an empty shared-library shell ready for cross-cutting utilities. All internal references are rewired and the full build/test pipeline passes.

Scopes: core, nmr

### Refactoring

- #43 refactor: Replace dist bin targets with thin wrapper scripts (#48)

The `bin` entries in `packages/core` and `packages/release-kit` pointed directly into `dist/esm/`, causing `pnpm install` to emit "Failed to create bin" warnings in fresh worktrees where `dist/` does not yet exist. Each bin entry now points to a committed wrapper script in `bin/` that dynamically imports the real entry point. The `files` field in both packages includes `bin` so the wrappers are published.

- #53 release-kit|refactor: Separate presentation from logic in prepare workflow (#57)

Extracts all `console.info` calls from the prepare workflow's logic functions (`bumpAllVersions`, `generateChangelogs`, `releasePrepare`, `releasePrepareMono`) into a dedicated `reportPrepare` formatter. Logic functions now return structured result types (`BumpResult`, `ComponentPrepareResult`, `PrepareResult`). The legacy `runReleasePrepare` entry point is retired, with its utilities absorbed into `prepareCommand`.

### Tests

- #17 release-kit|tests: Cover multi-changelogPaths and error paths (#44)

Add three tests for previously untested code paths:

- `releasePrepareMono`: component with two `changelogPaths` entries, asserting `git-cliff` is invoked once per path with the correct `--output` target.
- `getCommitsSinceTarget`: `git describe` failure with a non-128 exit status propagates as a wrapped error instead of being swallowed.
- `getCommitsSinceTarget`: `git log` failure is wrapped and re-thrown with the commit range in the message.

Also adds a `findAllCliffOutputPaths()` test helper that collects the `--output` arg from every `git-cliff` mock call.

### Tooling

- #37 root|tooling: Adopt nmr to run monorepo and workspace scripts (#38)

Replaces the legacy workspace script runner and ~25 root `package.json` scripts with `nmr`, the monorepo's own context-aware script runner. Root scripts are reduced to 4 (`prepare`, `postinstall`, `ci`, `bootstrap`), packages use direct build commands for bootstrap, and release-kit declares tier-3 test overrides for its integration test configs.

## [release-workflow-v1] - 2026-03-19

### Dependencies

- Root|deps: Add release-kit as root devDependency

Make `npx release-kit` and `pnpm exec release-kit` resolve within
this repo by adding a `workspace:*` dependency that symlinks the bin.

### Features

- #23 release-kit|feat: Add sync-labels command (#33)

Add a `release-kit sync-labels` command group with three subcommands (`init`, `generate`, `sync`) for declarative GitHub label management in monorepos. Bundle a reusable GitHub Actions workflow and composable label presets with the release-kit package. Introduce a `findPackageRoot` utility to replace fragile hardcoded path resolutions across the codebase.

- #34 release-kit|feat: Report up-to-date status for unchanged init files (#35)

`release-kit init` now compares existing file content against the default before reporting status. When an existing file is identical to the default (after normalizing trailing whitespace), it reports `✅ (up to date)` instead of the misleading `⚠️ (already exists)`.

- Release-workflow|feat: Accept force input

Pass `--force` to the prepare command so callers can force a version
bump even when there are no release-worthy changes.

## [release-kit-v2.1.0] - 2026-03-17

### Features

- #7 release-kit|feat!: Slim down release workflow by removing unnecessary pnpm install (#21)

Make release-kit self-contained by invoking git-cliff via `npx --yes` instead of requiring it on PATH, and by appending modified file paths to the format command so lightweight formatters like `npx prettier --write` work without a full `pnpm install`. Update init templates, README, and consuming repo config/workflow to reference workflow v3.

- #22 release-kit|feat: Add --force flag to release-kit prepare (#25)

Add a `--force` flag to `release-kit prepare` that bypasses the "no commits since last tag" check in monorepo mode, allowing version bumping and changelog generation to proceed even when no new commits are found since the last release tag. The flag requires `--bump` since there are no commits to infer bump type from. The local release workflow gains a `force` boolean input for future use.

- #20 release-kit|feat!: Move reusable release workflow into repo (#26)

Moves the reusable release workflow from `williamthorsen/.github` into this repo as `release-workflow.yaml`, stripping all pnpm-related steps since release-kit now runs git-cliff and prettier via `npx` internally. Updates this repo's caller workflow to use a relative path and update init templates to reference the new location. Establishes a naming convention (`{name}-workflow.yaml` for reusable, `{name}.yaml` for callers) and independent versioning strategy (`{name}-workflow-v{major}` tags), documented in `.github/workflows/README.md`.

- #30 release-kit|feat: Allow git-cliff to be used without config (#31)

Adds a `resolveCliffConfigPath()` function that searches for a git-cliff config in a 4-step cascade (explicit path → `.config/git-cliff.toml` → `cliff.toml` → bundled `cliff.toml.template`), eliminating the requirement for consuming repos to maintain a cliff config copy. Restructures the `init` command to scaffold only the workflow file by default, with new `--with-config` and `--force` flags. Moves `.release-tags` from `/tmp/release-kit/` to project-local `tmp/` for predictable behavior in local runs.

### Refactoring

- #6 release-kit|refactor: Clean up release-kit post-migration issues (#19)

Addresses five code quality issues and a test coverage gap identified during the release-kit migration (#5). Extracts a duplicated `isRecord` type guard into a shared module, eliminates a double-read in `bumpAllVersions`, improves error handling in `usesPnpm` by replacing a silent catch with a structured error boundary, removes an unreachable `'feature'` pattern from version defaults, and adds an integration test for scaffold template path resolution.

## [release-kit-v1.0.1] - 2026-03-14

### Features

- #5 release-kit|feat: Migrate release-kit from toolbelt (#18)

Migrates the complete `@williamthorsen/release-kit` package (v1.0.1) from `williamthorsen/toolbelt` into `packages/release-kit/`, adds shebang preservation to the shared esbuild plugin for CLI binaries, and sets up dogfooding infrastructure so this monorepo uses release-kit for its own releases.

<!-- generated by git-cliff -->
