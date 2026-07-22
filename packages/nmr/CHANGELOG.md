# Changelog

All notable changes to this project will be documented in this file.

## 0.19.0 — 2026-07-22

### 🎉 Features

- 🚨 **Breaking:** Replace the dependency commands with nmr upgrade (#491)

  Adds `nmr upgrade` as an ergonomic wrapper for displaying and applying available dependency upgrades. Taze is used under the hood to set a soaking period (customizable, defaulting to 7 days) before recently published dependencies will be accepted.

  Removes the four dependency commands it replaces: `outdated`, `outdated:latest`, `update`, and `update:latest`.

### 📦 Dependencies

- Upgrade dependencies and align the Node support policy (#483)

  All four published packages (`nmr`, `nmr-core`, `release-kit`, and `v11y-check`) now require Node.js 24 or later, up from Node 18.17. Separately, `nmr-compile` now rebuilds when the TypeScript version changes.

## 0.18.2 — 2026-07-18

### 🐛 Bug fixes

- Fail the build on aliased imports that escape the package source (#475)

  Fixes an issue where an aliased import that resolved to a target outside the package's own source (one Node could not reach at runtime) passed the build but produced published output that crashed with a module-not-found error. `nmr-compile` now fails the build and reports the unresolvable import and where it pointed, so the problem surfaces before publish instead of in production. Aliased imports that resolve outside the source but remain genuinely external and runnable continue to build and ship unchanged.

## 0.18.1 — 2026-07-14

### 🐛 Bug fixes

- Fix the stale build cache, the unshipped rimraf dependency, and the aborting root clean (#471)

  Fixes the following issues:
  - `nmr clean` failed with a missing-command error in any project that had not separately installed `rimraf`, a tool nmr neither declared nor shipped.
  - If run from a monorepo root, `nmr clean` cleaned one package and then aborted, leaving every other package untouched. Only repos that build nmr from source were affected.
  - If run from a monorepo root, `nmr clean` ignored a package's own `clean` script.
  - `nmr compile` skipped the build for a package whose output had been deleted, because the sources were unchanged. The package compiled to an empty output directory with no error and no warning, and could be published as an empty tarball.
  - `nmr compile` reported missing output and recompiled on every run for a package whose sources emit nothing, such as a source tree of only declaration files.

## 0.18.0 — 2026-07-13

### 🐛 Bug fixes

- Remove the attw check and the nmr-attw binary (#469)

  Fixes an issue where a repo using nmr's default scripts could not pass `check:strict` without installing `@arethetypeswrong/cli` and conforming to inflexible requirements of questionable value. The `attw` check is removed.

## 0.17.2 — 2026-07-06

### 🐛 Bug fixes

- Replace the raw attw script with an nmr-attw wrapper (#461)

  Fixes the issues that made the default `nmr attw` check fail across monorepos:

  - packages with no published API failed with a false `NoResolution` error;
  - the check left stray `.tgz` files in the working tree ;
  - output was a verbose per-package table; now output is terse on success, full diagnostics only on failure (`--verbose` to force full output);
  - a missing `@arethetypeswrong/cli` gave a raw command-not-found; now a hint is given.

## 0.17.1 — 2026-07-01

### 🐛 Bug fixes

- Relocate nmr-compile's build cache out of the published dist (#457)

  Fixes an issue where packages built with nmr-compile shipped an internal build-cache file inside their published npm tarball.

## 0.17.0 — 2026-07-01

### 🎉 Features

- 🚨 **Breaking:** Rebuild nmr-compile on a unified tsc emit (#455)

  `nmr` now compiles a package's JavaScript and type declarations in one step, rewriting every import form — static, re-export, dynamic `import()`, bare side-effect, and tsconfig `paths` aliases — to runnable `.js` in both outputs. It now requires TypeScript 5.7 or newer as a peer dependency.

## 0.16.0 — 2026-06-30

### 🎉 Features

- 🚨 **Breaking:** Auto-activate integration test variant from config presence (#448)

  A package can now separate its integration tests from its standalone suite simply by including a `vitest.integration.config.ts` (alongside a `vitest.standalone.config.ts`). The `--int-test` flag that previously enabled this is removed — that config-file pairing is now the only way to activate the separation. In such a package, `test` and `test:coverage` run only the standalone suite and skip integration tests, while a new `test:all` runs both suites together. The separation now holds even when tests run across every package at once, so a full-workspace `test` run still keeps integration tests out of the default suite. Packages that previously hand-copied these test scripts no longer need to.

### 🐛 Bug fixes

- Prevent CLI output truncation when piped before exit (#446)

  Fixes an issue where large output from the `nmr` and `v11y` commands could be truncated when captured through a pipe — for example, by a CI job.

### ♻️ Refactoring

- Migrate ensure-prepublish-hooks to nmr-core parseArgs (#429)

  `ensure-prepublish-hooks` now parses its arguments with `nmr-core`'s shared `parseArgs` utilities instead of a hand-rolled `for`/`switch` loop, removing the last bespoke argument parser in the `nmr` package. Every `nmr` CLI now shares one argument-parsing and error-reporting path; as a side effect, stray positional arguments are ignored rather than rejected, while unknown flags and a missing `--command` value still exit non-zero.

## 0.15.0 — 2026-06-27

### 🎉 Features

- Centralize the per-package build as an nmr-compile bin (#419)

  Introduces `nmr-compile`, a single command shipped with `@williamthorsen/nmr` that compiles each workspace package and now backs the default build. Consuming repos can delete their own per-package build script and pick up future build fixes just by upgrading nmr. Repeated builds with unchanged source now reliably skip recompiling instead of occasionally rebuilding for no reason, and import aliases now resolve correctly in symlinked checkouts.

### 🐛 Bug fixes

- Write the build cache only after a successful compile (#421)

  Fixes an issue where a package compile that failed partway — from a crash, disk error, or transient build failure — could leave stale or incomplete output that the next build skipped over as unchanged. The next build now retries the failed compile, so recovering no longer requires a manual `nmr clean` or a source-file edit.

- Stop sync-agent-files --check failing on version-only bumps (#424)

  Fixes an issue where `nmr sync-agent-files --check` failed after an nmr upgrade even when the managed agent guidance was identical. The check now passes whenever the guidance content is current, even if the version has changed.

- Remove inapplicable bootstrap fallback from agent guidance (#425)

  Fixes an issue where the agent guidance bundled with nmr told coding agents to run a recovery step that exists only in the nmr repo itself.

### ♻️ Refactoring

- Sync workflow pnpm version via yaml document API (#412)

  `nmr sync-pnpm-version` now updates every pinned pnpm version in a workflow, not just the first, so a workflow that pins the version across multiple jobs no longer leaves later jobs on a stale version.

## 0.14.2 — 2026-06-16

### ♻️ Refactoring

- Migrate from js-yaml to yaml (#410)

  Replaces the `js-yaml` dependency with the `yaml` package for all YAML reading and writing, with no change to behavior or generated output. The swap trims the dependency footprint by dropping a direct dependency and its companion type-definitions package, since `yaml` ships its own types.

## 0.14.1 — 2026-05-19

### ♻️ Refactoring

- Restructure tests and align core package directory with package name (#405)

  Tests in every package are now typechecked alongside the code they cover, so type breakage in tests fails the build instead of slipping through. The `core` package's workspace directory is renamed to match its package name, so `nmr -F nmr-core ...` and `pnpm --filter nmr-core ...` now resolve where they previously failed.

### 🧪 Tests

- Eliminate subprocess-startup flakiness in CLI tests (#403)

  The `nmr` CLI test suite now passes deterministically and no longer leaks subprocess output to the vitest terminal. Production CLI behavior — output streaming, exit codes, error messages — is unchanged.

## 0.14.0 — 2026-05-10

### ⚙️ Tooling

- Expose workspace bins from any subdir and simplify nmr docs (#374)

  Workspace bins like `nmr`, `release-kit`, and `audit-deps` are now invocable from any subdirectory under the monorepo when direnv is active, replacing the previous root-only `.envrc` recipe. The nmr usage docs are restructured to present two unambiguous resolution modes — direnv (recommended) and `pnpm exec nmr` — and the repo's README now documents direnv as the recommended setup.

## 0.13.0 — 2026-05-04

### 🎉 Features

- Add :pre and :post hook conventions to nmr commands (#339)

  Adds `:pre` and `:post` hook conventions to nmr's command runner. Consumers can declare `X:pre` or `X:post` scripts that nmr runs automatically before and after script `X`. The hook commands are optional and ignored if missing. Hooks fire even when the main command is overridden, and direct invocations like `nmr build:pre` are treated as leaf operations rather than recursively cascading into `build:pre:pre` lookups.

- Filter `nmr --help` to nmr commands (#348)

  Restricts `nmr --help` to nmr commands only. Hook scripts (names ending in `:pre` or `:post`) are now hidden from help, and generic `package.json` lifecycle scripts (`prepare`, `postinstall`, `bootstrap`) no longer appear. When a `package.json` script overrides a built-in nmr command, the override is shown inline alongside the command name with a `*` marker, and a single `* Overridden by package.json` footnote is appended whenever any marker is rendered. Help also now reflects the active resolution context: invoked from a subpackage you see workspace-level overrides; invoked from the repo root (or with `-w`) you see root-level overrides.

### 🐛 Bug fixes

- Honor -w flag in composite-script step subprocesses (#346)

  Fixes an issue where invoking `nmr -w <command>` from inside a workspace package, with `<command>` resolving to a composite (multi-step) script defined at the root level, failed with `Unknown command` for any step that was reachable only via the root script registry. The `-w` flag is now propagated to every step's subprocess invocation, so composite scripts run end-to-end regardless of which directory they are invoked from.

### ♻️ Refactoring

- Read package version at runtime via shared helper (#338)

  Fixes an issue where running `audit-deps`, `nmr`, or `release-kit` from the locally built `dist/esm/` after a `git pull` could report a stale version. Each CLI now reads its version directly from its `package.json` at startup, so version reads stay in sync with the installed source without requiring a fresh `pnpm install` or rebuild.

## 0.12.0 — 2026-04-23

### 🎉 Features

- Add agent-facing AGENTS.md and sync-agent-files command (#263)

  Ships nmr-owned agent guidance alongside the `@williamthorsen/nmr` package so consuming repos stop hand-maintaining their own copies of the runner's invocation rules. A new `nmr sync-agent-files` command pulls that guidance into `.agents/nmr/AGENTS.md` in the consuming repo, stamped with the installed nmr version; a companion `--check` variant verifies the stamp against the installed version on every root `check:strict` run. Drift between installed nmr and the committed guidance now fails the quality gate automatically with a single actionable fix message, without per-consumer wiring.

- Rename check:fixable script to fix:check (#266)

  Renames the `check:fixable` convenience script to `fix:check` in both the workspace and root default script registries. The new name mirrors the existing `fmt` / `fmt:check` pattern, aligning the read-only variant with its mutating counterpart (`fix`) so the command's read-only semantics are recognizable from the name alone.

  The script's expansion (`fmt:check`, `lint:check`) is unchanged.

## 0.11.0 — 2026-04-17

### 🎉 Features

- Add `check:fixable` convenience script (#223)

  Adds a new `check:fixable` convenience script to the `nmr` default script registries, providing a read-only partner to the existing `fix` script. Running `nmr check:fixable` expands to `nmr fmt:check && nmr lint:check`, verifying that a tree is clean of auto-fixable violations without modifying any files.

- Show package name in override-script messages (#226)

  Adds the package directory name as a prefix to override-script log messages, making it easy to identify which package each message belongs to when running commands across multiple workspaces. Also introduces a distinct no-op (`:`) condition that logs a skip message and exits cleanly, separate from the existing empty-string case.

- Migrate nmr audit scripts to use audit-deps (#234)

  Migrates nmr's built-in `audit:dev` and `audit:prod` root scripts from calling `audit-ci` directly via `pnpm dlx` to delegating to the `audit-deps` CLI wrapper via `pnpm exec audit-deps`. Removes the now-obsolete `.config/audit-ci/` directory and its JSON5 config files, since `audit-deps` uses its own config at `.config/audit-deps.config.json`. Updates the nmr readyup kit to check for `@williamthorsen/audit-deps` installation instead of checking for legacy audit-ci directory placement.

## 0.10.0 — 2026-04-16

### 🎉 Features

- Decouple audit from CI quality gate and add audit workflow (#210)

  Dependency audit is now decoupled from the CI quality gate so that transient upstream CVEs no longer block the merging of unrelated code changes. Audit now runs in a dedicated workflow with non-blocking PR integration (acknowledgment checkbox) and a daily scheduled run that tracks results in a standing GitHub issue. A readyup kit is available to validate the new setup in consuming repos.

## 0.9.2 — 2026-04-15

### ⚙️ Tooling

- Enable automated publication to npm (#187)

  Prepares the repository for reliable tag-triggered npm publishing by adding missing package metadata, standardizing licensing, and introducing a readyup kit that validates publish readiness across all packages.

## 0.9.0 — 2026-04-04

### 🎉 Features

- Add --version flag to nmr and release-kit (#143)

  Adds `--version` / `-V` support to the `nmr` and `release-kit` CLIs, matching the existing `preflight` behavior. Moves the build-time version generation script to the shared `config/` directory so all three packages use a single `generateVersion.ts`.

- Add devBin config for source-repo binary substitution (#146)

  Adds a `devBin` config field to nmr that maps binary names to replacement commands, with relative paths resolved from the monorepo root. Documents `":"` as the recommended way to disable a script when `eslint-plugin-package-json/valid-scripts` forbids empty strings.

- Detect and report missing build output in bin wrappers (#152)

  Adds try/catch with `ERR_MODULE_NOT_FOUND` detection to all six bin wrappers across `nmr`, `preflight`, and `release-kit`. Previously, five of the six wrappers used bare `import()` calls that produced cryptic unhandled rejections when `dist/` was missing, and `preflight`'s existing try/catch gave no actionable guidance.

### 📚 Documentation

- Refine README to match preflight documentation standard (#137)

  Rewrites the nmr README to match the documentation standard established by the preflight README (#114). Restructures content to follow the cross-package convention (header → installation → quick start → concepts → CLI reference), adds comprehensive reference tables for CLI flags, `defineConfig` fields, and all built-in script registries (workspace and root), and introduces visual aids for context-aware resolution and three-tier override precedence.

## 0.5.0 — 2026-03-31

### 🎉 Features

- Add `fix` script to workspace and root registries (#106)

  Adds a `fix` composite script to both the workspace and root script registries in nmr. The script runs `lint` then `fmt` in sequence, providing a single command to auto-fix linting and formatting issues.

## 0.4.0 — 2026-03-30

### 🎉 Features

- Add default root scripts and split registry module (#96)

  Adds four new default root scripts to nmr (`fmt:sh`, `fmt:all`, `clean`, `root:check`) and split the monolithic `registries.ts` into a data-only `default-scripts.ts` and a composition-logic `resolve-scripts.ts`.

  Also fixes the `ci` and `check:strict` script ordering to run build before strict checks, and corrects stale test assertions.

## 0.3.0 — 2026-03-29

### 🎉 Features

- Resolve package.json scripts at root level and skip in recursive mode (#95)

  Pass `monorepoRoot` as `packageDir` when `isRoot` is true so root `package.json` scripts participate in the same override tier that workspace packages already use.

  Set `NMR_RUN_IF_PRESENT=1` in the `-R` codepath so child processes that can't resolve a command exit 0 (skip) instead of exit 1.

  Only log "Using override script" when the `package.json` script actually overrides a registry command.

  Remove the self-referencing `ci: "nmr ci"` script from root `package.json` and update the CI workflow to use `code-quality-pnpm-workflow.yaml@v4` with an explicit `check-command`.

## 0.2.0 — 2026-03-28

### 🎉 Features

- Add ensure-prepublish-hooks binary (#75)

  New binary that checks whether all publishable (non-private) workspace packages have a `prepublishOnly` script, and optionally adds one.

  - Check mode (default): reports each non-private package's `prepublishOnly` status, exits non-zero if any are missing.
  - Fix mode (`--fix`): inserts `prepublishOnly` into packages that lack it. Supports `--dry-run`.
  - Custom command (`--command`): overrides the default hook value (`npm run build`).

  Also adds `private` field extraction to the shared `PackageJson` interface.

### 📚 Documentation

- Document utility binaries

  Add README sections for the package's additional commands. Subcommands (report-overrides, sync-pnpm-version) are documented under "Additional subcommands" with nmr invocation syntax. The standalone ensure-prepublish-hooks utility is documented separately under "Standalone utilities".

  Also fix the executable bit on bin/ensure-prepublish-hooks.js to match the other bin entries.

## 0.1.1 — 2026-03-28

### 🎉 Features

- Extract nmr CLI from core package (#61)

  Extracts all nmr CLI code from `packages/core` into a new `packages/nmr` package (`@williamthorsen/nmr`). Core is reduced to an empty shared-library shell ready for cross-cutting utilities. All internal references are rewired and the full build/test pipeline passes.

  Scopes: core, nmr

### ♻️ Refactoring

- Extract helpers to reduce duplication in config and consistency modules (#62)

  Extracts two small helpers to consolidate structurally duplicated code in the nmr package. A new `getStringFromYamlFile` helper in `tests/helpers/` replaces the repeated YAML-read-parse-extract pattern in `consistency.ts`, and a private `validateScriptField` helper in `config.ts` replaces the duplicated script-record validation blocks.

<!-- Generated by release-kit. Do not edit this file. Use .meta/changelog-overrides.json to override entries. -->
