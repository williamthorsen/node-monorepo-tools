# Changelog

All notable changes to this project will be documented in this file.

## [nmr-v0.11.0] - 2026-04-17

### Features

- Add `check:fixable` convenience script (#223)

  Adds a new `check:fixable` convenience script to the `nmr` default script registries, providing a read-only partner to the existing `fix` script. Running `nmr check:fixable` expands to `nmr fmt:check && nmr lint:check`, verifying that a tree is clean of auto-fixable violations without modifying any files.

- Show package name in override-script messages (#226)

  Adds the package directory name as a prefix to override-script log messages, making it easy to identify which package each message belongs to when running commands across multiple workspaces. Also introduces a distinct no-op (`:`) condition that logs a skip message and exits cleanly, separate from the existing empty-string case.

- Migrate nmr audit scripts to use audit-deps (#234)

  Migrates nmr's built-in `audit:dev` and `audit:prod` root scripts from calling `audit-ci` directly via `pnpm dlx` to delegating to the `audit-deps` CLI wrapper via `pnpm exec audit-deps`. Removes the now-obsolete `.config/audit-ci/` directory and its JSON5 config files, since `audit-deps` uses its own config at `.config/audit-deps.config.json`. Updates the nmr readyup kit to check for `@williamthorsen/audit-deps` installation instead of checking for legacy audit-ci directory placement.

## [nmr-v0.10.0] - 2026-04-16

### Features

- Decouple audit from CI quality gate and add audit workflow (#210)

  Dependency audit is now decoupled from the CI quality gate so that transient upstream CVEs no longer block the merging of unrelated code changes. Audit now runs in a dedicated workflow with non-blocking PR integration (acknowledgment checkbox) and a daily scheduled run that tracks results in a standing GitHub issue. A readyup kit is available to validate the new setup in consuming repos.

## [nmr-v0.9.2] - 2026-04-15

### Tooling

- Enable automated publication to npm (#187)

  Prepares the repository for reliable tag-triggered npm publishing by adding missing package metadata, standardizing licensing, and introducing a readyup kit that validates publish readiness across all packages.

## [nmr-v0.9.0] - 2026-04-04

### Documentation

- Refine README to match preflight documentation standard (#137)

  Rewrites the nmr README to match the documentation standard established by the preflight README (#114). Restructures content to follow the cross-package convention (header → installation → quick start → concepts → CLI reference), adds comprehensive reference tables for CLI flags, `defineConfig` fields, and all built-in script registries (workspace and root), and introduces visual aids for context-aware resolution and three-tier override precedence.

### Features

- Add --version flag to nmr and release-kit (#143)

  Adds `--version` / `-V` support to the `nmr` and `release-kit` CLIs, matching the existing `preflight` behavior. Moves the build-time version generation script to the shared `config/` directory so all three packages use a single `generateVersion.ts`.

- Add devBin config for source-repo binary substitution (#146)

  Adds a `devBin` config field to nmr that maps binary names to replacement commands, with relative paths resolved from the monorepo root. Documents `":"` as the recommended way to disable a script when `eslint-plugin-package-json/valid-scripts` forbids empty strings.

- Detect and report missing build output in bin wrappers (#152)

  Adds try/catch with `ERR_MODULE_NOT_FOUND` detection to all six bin wrappers across `nmr`, `preflight`, and `release-kit`. Previously, five of the six wrappers used bare `import()` calls that produced cryptic unhandled rejections when `dist/` was missing, and `preflight`'s existing try/catch gave no actionable guidance.

## [nmr-v0.5.0] - 2026-03-31

### Features

- Add `fix` script to workspace and root registries (#106)

  Adds a `fix` composite script to both the workspace and root script registries in nmr. The script runs `lint` then `fmt` in sequence, providing a single command to auto-fix linting and formatting issues.

## [nmr-v0.4.0] - 2026-03-30

### Features

- Add default root scripts and split registry module (#96)

  Adds four new default root scripts to nmr (`fmt:sh`, `fmt:all`, `clean`, `root:check`) and split the monolithic `registries.ts` into a data-only `default-scripts.ts` and a composition-logic `resolve-scripts.ts`.

  Also fixes the `ci` and `check:strict` script ordering to run build before strict checks, and corrects stale test assertions.

## [nmr-v0.3.0] - 2026-03-29

### Features

- Resolve package.json scripts at root level and skip in recursive mode (#95)

  Pass `monorepoRoot` as `packageDir` when `isRoot` is true so root `package.json` scripts participate in the same override tier that workspace packages already use.

  Set `NMR_RUN_IF_PRESENT=1` in the `-R` codepath so child processes that can't resolve a command exit 0 (skip) instead of exit 1.

  Only log "Using override script" when the `package.json` script actually overrides a registry command.

  Remove the self-referencing `ci: "nmr ci"` script from root `package.json` and update the CI workflow to use `code-quality-pnpm-workflow.yaml@v4` with an explicit `check-command`.

## [nmr-v0.2.0] - 2026-03-28

### Documentation

- Document utility binaries

  Add README sections for the package's additional commands. Subcommands (report-overrides, sync-pnpm-version) are documented under "Additional subcommands" with nmr invocation syntax. The standalone ensure-prepublish-hooks utility is documented separately under "Standalone utilities".

  Also fix the executable bit on bin/ensure-prepublish-hooks.js to match the other bin entries.

### Features

- Add ensure-prepublish-hooks binary (#75)

  New binary that checks whether all publishable (non-private) workspace packages have a `prepublishOnly` script, and optionally adds one.
  - Check mode (default): reports each non-private package's `prepublishOnly` status, exits non-zero if any are missing.
  - Fix mode (`--fix`): inserts `prepublishOnly` into packages that lack it. Supports `--dry-run`.
  - Custom command (`--command`): overrides the default hook value (`npm run build`).

  Also adds `private` field extraction to the shared `PackageJson` interface.

## [nmr-v0.1.1] - 2026-03-28

### Features

- Extract nmr CLI from core package (#61)

  Extracts all nmr CLI code from `packages/core` into a new `packages/nmr` package (`@williamthorsen/nmr`). Core is reduced to an empty shared-library shell ready for cross-cutting utilities. All internal references are rewired and the full build/test pipeline passes.

  Scopes: core, nmr

### Refactoring

- Extract helpers to reduce duplication in config and consistency modules (#62)

  Extracts two small helpers to consolidate structurally duplicated code in the nmr package. A new `getStringFromYamlFile` helper in `tests/helpers/` replaces the repeated YAML-read-parse-extract pattern in `consistency.ts`, and a private `validateScriptField` helper in `config.ts` replaces the duplicated script-record validation blocks.

<!-- generated by git-cliff -->
