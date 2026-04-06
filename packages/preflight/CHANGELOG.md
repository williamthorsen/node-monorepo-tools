# Changelog

All notable changes to this project will be documented in this file.

## [preflight-v0.12.0] - 2026-04-06

### Features

- #157 preflight|feat: Nest dependent checks in the preflight report (#174)

Makes `PreflightCheck` recursive by adding an optional `checks` field for dependent checks.

The runner executes children when a parent passes, skips descendants when a parent fails or is N/A, and produces results in depth-first order with a `depth` field. The human-readable report indents nested checks, suppresses N/A descendants (showing the N/A parent with its skip reason), and prefixes fix messages with 💊.

The JSON report reconstructs the tree from flat results, nesting child entries under their parent's `checks` array. Existing collections are restructured to use nesting where natural dependencies exist, and a new demo collection exercises every preflight feature.

## [preflight-v0.11.0] - 2026-04-06

### Bug fixes

- #154 preflight|fix: Add missing mutual-exclusivity guard for `--file` flag (#163)

Add the missing `assertNoExistingSource` guard to the `--file` branch in `parseRunArgs`, making the mutual-exclusivity check for source flags symmetric regardless of flag order.

### Features

- #153 preflight|feat: Unify collections under .preflight/collections/ (#158)

Consolidates the split between .config/preflight/collections/ (internal) and .preflight/distribution/ (distributable) into a single .preflight/collections/ directory. Simplifies the config path from .config/preflight/config.ts to .config/preflight.config.ts now that the nested directory no longer holds collections.

- #130 preflight|feat: Export reusable check-utils for collection authors (#165)

Extracts 9 inline helper functions from `.preflight/collections/nmr.ts` into `packages/preflight/src/check-utils/`, organized by domain (filesystem, package-json, semver). Re-exports all functions from the main `@williamthorsen/preflight` entry point so collection authors can import them directly. Updates the collection file to use the package imports instead of inline definitions.

- #166 preflight|feat: Support configurable internal collections directory (#171)

Adds an `internal` config block to preflight with `dir` and `extension` fields that control where default (no-source-flag) collections are resolved from. Extracts `resolveCollectionSource` from `parseRunArgs` into a standalone function so that async config loading can feed internal config values into source resolution.

- #169 preflight|feat: Default to batch compilation when no arguments given (#172)

`preflight compile` with no arguments now compiles all sources from the config's `srcDir`, matching the convention already established by `preflight run`. The `--all` / `-a` flag is removed.

The no-arguments path in `compileCommand` now falls through to `compileBatch()` instead of printing an error. A new validation rejects `--output` without a positional argument, since batch mode does not support per-file output paths.

### Refactoring

- #156 preflight|refactor: Extract authoring helpers from entry point (#159)

Extracts the five `define*` identity functions from `config.ts` into a new `authoring.ts` module with zero transitive dependencies on zod or jiti. Slims `index.ts` to export only the lightweight authoring API and types, removing all runtime exports (`loadConfig`, `runPreflight`, formatters).

## [preflight-v0.10.0] - 2026-04-04

### Bug fixes

- #140 preflight|fix: Catch module-resolution errors in loadConfig (#144)

Wraps the `jiti.import()` call in `loadConfig` with a try/catch that catches `MODULE_NOT_FOUND` and `ERR_MODULE_NOT_FOUND` errors and rethrows with an actionable message. Extracts the shared jiti-import-with-error-handling pattern from both `loadConfig` and `loadPreflightCollection` into a new `jitiImport` helper to deduplicate the logic and resolve a cyclomatic complexity lint violation.

### Documentation

- #114 preflight|docs: Add README (#133)

Adds a comprehensive README for the `@williamthorsen/preflight` package, covering installation, quick start, configuration authoring API, remote distribution workflow, CLI reference, and JSON output format.

### Features

- #139 preflight|feat: Improve CLI ergonomics and error handling (#141)

Makes `run` the implicit default command, fix jiti module resolution to use the config file's path, replace raw Node.js errors with actionable messages for missing dependencies, add `--version`/`-V` support, improve top-level help to surface run-subcommand flags, and show relative paths in file-not-found errors.

- #142 feat: Add --version flag to nmr and release-kit (#143)

Adds `--version` / `-V` support to the `nmr` and `release-kit` CLIs, matching the existing `preflight` behavior. Moves the build-time version generation script to the shared `config/` directory so all three packages use a single `generateVersion.ts`.

- #128 preflight|feat: Add severity levels, thresholds, and skip conditions (#147)

`PreflightResult` is now a discriminated union (`PassedResult | FailedResult | SkippedResult`) with all fields non-optional using explicit `null`. Every result carries a `severity` field (`error | warn | recommend`).

Checks can declare a `skip` function returning `false | string` to mark themselves as not applicable. Skip function throws are treated as check failures.

Two new thresholds control run behavior: `failOn` (which severity causes exit code 1) and `reportOn` (which severity appears in output). Both are configurable at the collection level and overridable via `--fail-on` and `--report-on` CLI flags. The cascade is: CLI flag > collection field > default.

Staged checklist progression halts only when a failure meets the `failOn` threshold. Summary counts in both human and JSON output reflect only results above the `reportOn` threshold.

`FixLocation` normalized from `'INLINE' | 'END'` to `'inline' | 'end'`. `ReportOptions` removed from the public API. JSON count fields renamed from `passedCount`/`failedCount`/`skippedCount` to `passed`/`failed`/`skipped`. `JsonCheckEntry` includes `skipReason: null` on non-skipped entries for uniform JSON shape.

- #150 feat: Detect and report missing build output in bin wrappers (#152)

Adds try/catch with `ERR_MODULE_NOT_FOUND` detection to all six bin wrappers across `nmr`, `preflight`, and `release-kit`. Previously, five of the six wrappers used bare `import()` calls that produced cryptic unhandled rejections when `dist/` was missing, and `preflight`'s existing try/catch gave no actionable guidance.

### Refactoring

- #145 refactor: Extract shared CLI argument-parsing utility into core (#151)

Add a schema-driven `parseArgs` function to `@williamthorsen/node-monorepo-core` that handles boolean flags, string flags (both `--flag=value` and `--flag value`), short aliases, positional collection, the `--` delimiter, and unknown-flag errors. Migrate all CLI argument-parsing sites in preflight (3 sites) and release-kit (5 sites) to use it. A companion `translateParseError` helper normalizes internal error messages for consistent user-facing output.

## [preflight-v0.6.0] - 2026-04-02

### Features

- #125 feat: Rename reusable workflows to .reusable.yaml convention (#129)

Renames all three reusable GitHub Actions workflow files from the inconsistent `-workflow.yaml`/bare `.yaml` convention to a uniform `.reusable.yaml` suffix. Updates all references across caller workflows, release-kit templates, tests, preflight collection, and documentation. Scaffolds the sync-labels caller workflow and labels file for this repo. Deletes superseded legacy files.

## [preflight-v0.5.0] - 2026-04-02

### Features

- #116 preflight|feat: Add `preflight compile` CLI command for bundling remote configs (#117)

Adds `preflight compile <input>` CLI command that bundles TypeScript checklist files into self-contained ESM bundles using esbuild (optional peer dependency). The bundler externalizes `node:*` builtins and inlines all other imports.

Standardizes config loaders (`loadPreflightConfig`, `loadRemoteConfig`) on named `checklists` and `fixLocation` exports instead of `default`/`config`. Add `defineChecklists` identity helper as the recommended way to author checklist files. Migrate `config/preflight.config.ts` to the new convention.

- #118 preflight|feat: Separate checklist collection from preflight config (#120)

Splits the `PreflightConfig` type into two distinct concepts: `PreflightConfig` for repo-level settings (`compile.srcDir`/`outDir`) and `PreflightCollection` for checklist files. Normalized all `CheckList` identifiers to `Checklist`, overhauled CLI flags to separate collection sources from config, added a config file loader with lookup chain, implemented internal collection discovery, updated init scaffolding to produce both a config and a collection file, and migrated the repo's own checklists to `.preflight/distribution/`.

- #99 preflight|feat: Support named suites of checklists (#123)

Wires up the existing `suites` stub on `PreflightCollection` end-to-end: pass through export resolution, adds a shared validator for name-collision and referential-integrity checks, integrate validation into the compile path, and expand suite names in CLI checklist selection.

- #122 preflight|feat: Validate suites field shape with Zod schemas (#124)

Replaces hand-rolled structural assertions in `assertIsPreflightCollection` and `assertIsPreflightConfig` with declarative Zod schemas. This adds the missing `suites` field validation (`Record<string, string[]>`) and consolidates three identical `isRecord` helper definitions into a single shared utility.

## [preflight-v0.4.0] - 2026-03-31

### Features

- #24 prerelease|feat: Add drift-detection config for convention compliance (#101)

Adds a portable preflight config (`packages/preflight/configs/drift.config.ts`) with five checklists that detect convention drift across repos. The config covers release-kit adoption, label-sync setup, nmr installation, code-quality workflow versioning, and general repo setup conventions (agent guidance files, editor configs, audit-ci configs, package.json fields, and tool-version hygiene).

- #98 preflight|feat: Support structured check outcomes with detail and progress (#102)

Widens the preflight check return type from `boolean` to `boolean | CheckOutcome`, where `CheckOutcome` carries an `ok` boolean plus optional `detail` (string) and `progress` (fraction or percentage) fields. The runner normalizes both return shapes, propagates `detail` and `progress` through `PreflightResult`, and the reporter renders them inline with em-dash separators for all check statuses.

- #104 preflight|feat: Add combined summary after all checklists run (#108)

Adds a combined summary table that prints after all checklists complete when two or more checklists run. Each row shows a pass/fail icon, checklist name, aligned duration, and non-zero counts. A Total line aggregates across all checklists with icon-prefixed counts and total duration. The single-checklist summary line is also updated to use icon-prefixed counts with zero omission. All status icons are changed to a traffic-light scheme (🟢/🔴/⛔) to align with the planned "greenlight" package name.

- #107 preflight|feat: Add `--json` flag for structured output (#111)

Adds `--json` to the `run` subcommand so consumers can pipe structured output. When the flag is set, all human-readable output (headers, `reportPreflight`, `formatCombinedSummary`) is suppressed and a single JSON object is emitted to stdout. Error paths (config loading, unknown checklist names) also emit JSON to stdout instead of plain text to stderr, while the exit code still signals success or failure.

New modules: `formatJsonReport` transforms `PreflightReport[]` into the JSON shape, and `formatJsonError` wraps error messages. `formatJsonReport` is exported from the package index for library consumers.

- #103 preflight|feat: Support remote config URLs (#115)

Adds `--github` and `--url` flags to `preflight run` so it can fetch and evaluate remote `.js` config bundles hosted on GitHub or any URL. Extracts config validation into a shared module reused by both local and remote loaders.

### Refactoring

- #109 preflight|refactor: Add `type` discriminant to `Progress` union (#112)

Adds a `type` field (`"fraction"` | `"percent"`) to `FractionProgress` and `PercentProgress` so consumers can switch on a single key instead of checking for the presence of specific fields. This is especially important for JSON consumers who don't have TypeScript's type narrowing.

Updates `isPercentProgress` to use `progress.type === "percent"`. Upgrade `JsonProgress` from a flat optional-field bag to a proper discriminated union mirroring the source type.

## [preflight-v0.3.1] - 2026-03-30

### Bug fixes

- #92 preflight|fix: Add types export condition for nodenext resolution

TypeScript with --moduleResolution nodenext could not resolve types from
@williamthorsen/preflight because the exports map lacked a types condition.

## [preflight-v0.3.0] - 2026-03-29

### Features

- #8 feat: Add shared writeFileWithCheck utility and overwrite reporting (#66)

Extracts three duplicated `writeIfAbsent` implementations and two duplicated terminal helper sets into shared utilities in `@williamthorsen/node-monorepo-core`, then migrates all consumers (`release-kit init`, `preflight init`, `sync-labels`) to use them. All init commands now report which files were created, overwritten, skipped, or failed — including when `--force` replaces existing files.

## [preflight-v0.2.0] - 2026-03-27

### Features

- #51 preflight|feat: Add preflight-check package (#52)

Adds `@williamthorsen/preflight`, a new package for running configurable pre-deployment checks with structured pass/fail reporting. The package provides a runner (flat and staged checklists with precondition gating), a reporter (INLINE/END fix-location modes with emoji indicators), jiti-based config loading, and a CLI entry point.

- #56 preflight|feat: Add --help flag and init command (#58)

Adds `--help`/`-h` support at all levels and an `init` subcommand to the preflight CLI. The existing run-checks behavior moves behind a `run` subcommand, with bare `preflight` showing top-level help. The `init` command scaffolds a starter `.config/preflight.config.ts` with dry-run, force-overwrite, and up-to-date detection.

<!-- generated by git-cliff -->
