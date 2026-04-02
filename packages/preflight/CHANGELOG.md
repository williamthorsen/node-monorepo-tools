# Changelog

All notable changes to this project will be documented in this file.

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

## [preflight-v0.2.0] - 2026-03-27

### Features

- #51 preflight|feat: Add preflight-check package (#52)

Adds `@williamthorsen/preflight`, a new package for running configurable pre-deployment checks with structured pass/fail reporting. The package provides a runner (flat and staged checklists with precondition gating), a reporter (INLINE/END fix-location modes with emoji indicators), jiti-based config loading, and a CLI entry point.

- #56 preflight|feat: Add --help flag and init command (#58)

Adds `--help`/`-h` support at all levels and an `init` subcommand to the preflight CLI. The existing run-checks behavior moves behind a `run` subcommand, with bare `preflight` showing top-level help. The `init` command scaffolds a starter `.config/preflight.config.ts` with dry-run, force-overwrite, and up-to-date detection.

<!-- generated by git-cliff -->
