# Changelog

All notable changes to this project will be documented in this file.

## 0.10.2 — 2026-08-19

### 🧪 Tests

- Register fixture-repo cleanup against the test that asks for it (#715)

  Routes nmr's `buildRepo` fixture helper through `createTempTree`, registering each fixture directory's removal against the test that requested it. The module-level accumulator and the exported `removeFixtureDirs` have been removed.

- Convert the per-test temporary directories to test-scoped fixtures (#719)

  Converts the suites that create a temporary directory in `nmr`, `nmr-core`, and `release-kit` to take it as a Vitest fixture built on `createTempTree`, or as a `using` declaration where the directory lives and dies inside one test body. Each suite loses the mutable binding and the `beforeEach`/`afterEach` pair that carried the directory's lifetime, and a directory is created only for the tests that name one.

  Separately, `nmr lint:strict` now fails on a stale `eslint-disable` directive.

## 0.10.1 — 2026-08-17

### ♻️ Refactoring

- Adopt silenceConsole across the test suites (#677)

  Adopts `silenceConsole` from `@williamthorsen/toolbelt.vitest` to replace all hand-rolled `vi.spyOn(console, …)` spies and reduce boilerplate across the repo's test suites. The function returns a disposable, allowing the caller to use `using` to enable restoration of the console method at the end of the test scope.

- Adopt `isError` and consolidate errno narrowing on a shared helper (#697)

  Replaces every hand-rolled `instanceof Error` narrowing with `hasErrnoCode`, a new predicate exported from `@williamthorsen/nmr-core`, or with `isError` from `@williamthorsen/toolbelt.errors`. Previously the errno question was answered by inline copies alongside two private helpers of differing shape; both helpers are removed.

  Separately, `eslint.config.ts` now bans `instanceof Error` in every position rather than in a ternary alone.

### 🧪 Tests

- Replace the stdio spies with captureStdio (#678)

  Replaces every `process.stdout` and `process.stderr` spy in the test suites with `captureStdio` from `@williamthorsen/toolbelt.testing` and deletes the obviated local capture helpers. `captureStdio` buffers writes rather than recording calls, so assertions that previously used `toHaveBeenCalledWith` instead check `stderr`/`stdout` strings and their chunk arrays.

  Separately, `unicorn/no-nonstandard-builtin-properties` is off for test files. Its hand-maintained symbol table omits `Symbol.dispose`, which a suite-scoped capture calls to restore the streams, and `schema: []` offers no way to extend the table.

- Adopt throwOnProcessExit and captureError across the test suites (#690)

  Adopts `throwOnProcessExit` from `@williamthorsen/toolbelt.vitest`, replacing every hand-rolled `process.exit` mock in the `release-kit` and `nmr-core` test suites, and `captureError` from `@williamthorsen/toolbelt.testing`, replacing inline try/catch/`instanceof` blocks.

  Separately, `@williamthorsen/toolbelt.vitest` is now listed in the ReadyUp config, so that its kit is run by `rdy run --packages`.

## 0.10.0 — 2026-08-13

### 🎉 Features

- Print a retained run with nmr --log (#669)

  Adds `nmr --log <command>`, which prints what the last recorded pass wrote instead of running the command again. The whole transcript, up to a limit of 256 KiB, is now saved for any passing command that is not writing straight to a terminal; `--log` prints it under a header giving the instant, the duration, and the command chain that succeeded. The log of a composite is the sum of its constituents' excerpts. If a change disqualifies the recording, `--log` instead reports the change.

### ♻️ Refactoring

- Adopt toolbelt.errors for error-message extraction and cause-chaining (#652)

  Improves error reporting by adopting standardized ways of capturing and describing errors across the codebase.

### ⚙️ Tooling

- Upgrade the lint config and clear its violations (#671)

  Upgrades `@williamthorsen/eslint-config-typescript`, along with other config packages, and clears lint violations surfaced by the newly activated rules.

## 0.9.3 — 2026-08-08

### ⚙️ Tooling

- Migrate to the shared tsconfig baseline (#626)

  Adopts `@williamthorsen/tsconfig` as the standard TypeScript configuration for this repo, replacing the previous hand-maintained copy. Reading a property through an index signature now requires bracket notation or a type that declares the property. The `nmr` build now fails on a base TypeScript config it cannot resolve, rather than building without it, and it now resolves a base config named by package name alone.

## 0.9.1 — 2026-08-04

### 🐛 Bug fixes

- Remove the 1 MiB ceiling on captured git output (#596)

  Fixes an issue where `release-kit prepare` began aborting once a repository's release history grew long enough, leaving that repository unable to cut another release. The fix covers, in addition to `prepare`, every other release-kit command that reads from git.

## 0.9.0 — 2026-08-03

### 🎉 Features

- Publish nmr's readyup kit with a test-tier conformance check (#580)

  `@williamthorsen/nmr` is now bundled with ReadyUp kits that check a repo's alignment with `nmr` requirements and recommendations.

  `rdy run --from npm:@williamthorsen/nmr` checks the repo against the kits without prior configuration. Once the package is added to the ReadyUp config, `rdy run --packages` will run the `nmr` kits along with those of any other registered package. Requires `readyup` v0.23 or greater.

## 0.8.0 — 2026-08-03

### 🎉 Features

- Skip checks that already passed on the current working tree (#568)

  `nmr` commands now skip any pure check (types, lint, tests) that has already passed on an unchanged working tree; instead, success is reported immediately. `nmr --no-cache` causes the cache check to be skipped, and `NMR_NO_CACHE=1` does the same for a whole shell. Cached results are cleared by `nmr clean`. Which commands can skip is configurable at the monorepo root, and `NMR_DEBUG=1` reports why a run didn't skip.

### ♻️ Refactoring

- Share nmr-core's cache primitives with nmr-compile (#570)

  A package's writes to the build cache are now hidden from other packages until the write is complete. A failing build now reports its error in the same form as every other `nmr` command. `tsx` is no longer required to build a package.

## 0.7.3 — 2026-07-30

### ⚙️ Tooling

- Adopt Vitest projects in this repo (#530)

  Simplifies test configurations so that every package exposes the same test commands, which select suites by test category: `nmr test` runs everything except integration tests, `nmr test:integration` runs only those, and `nmr test:all` runs both. `nmr test:integration` now succeeds in a package that has no integration tests instead of failing. release-kit's drift checks can now be run on their own, apart from unit and integration tests. A fresh clone now has to run `pnpm run bootstrap` before any test run, not just before `nmr` commands.

## 0.7.1 — 2026-07-22

### 📦 Dependencies

- Upgrade dependencies and align the Node support policy (#483)

  All four published packages (`nmr`, `nmr-core`, `release-kit`, and `v11y-check`) now require Node.js 24 or later, up from Node 18.17. Separately, `nmr-compile` now rebuilds when the TypeScript version changes.

## 0.7.0 — 2026-07-13

### 🎉 Features

- 🚨 **Breaking:** Fail a package that declares types but ships none (#467)

  `nmr attw` now fails a package that claims to ship type declarations but ships none. Such a package used to pass, leaving every TypeScript consumer of it silently typed as `any`.

  A package that ships working declarations found only by sitting beside its JavaScript entry point escapes the check, since it declares nothing. Add a `types` entry to bring it under the check.

## 0.6.0 — 2026-07-01

### 🎉 Features

- 🚨 **Breaking:** Rebuild nmr-compile on a unified tsc emit (#455)

  `nmr` now compiles a package's JavaScript and type declarations in one step, rewriting every import form — static, re-export, dynamic `import()`, bare side-effect, and tsconfig `paths` aliases — to runnable `.js` in both outputs. It now requires TypeScript 5.7 or newer as a peer dependency.

## 0.5.0 — 2026-06-30

### 🎉 Features

- 🚨 **Breaking:** Rewrite parseArgs on node:util with typed error and exit API (#428)

  `@williamthorsen/nmr-core` gains a typed error API for CLI parsing: `parseArgsOrExit` (parse, or print a usage error and exit) and `ParseError` replace the per-command boilerplate, so every bundled CLI reports a flag mistake the same way. Breaking: the `translateParseError` export is removed and `parseArgs` now throws `ParseError`.

- Reject unexpected positional arguments by default (#432)

  Commands built on nmr-core now reject unexpected positional arguments by default. Commands that take positional arguments can opt back in to accept them.

### ♻️ Refactoring

- Route all CLI error reporting through a single stderr helper (#437)

  Consolidates error reporting across the CLIs so every command reports errors the same way, and guards against the previous inconsistency returning. The error messages and exit codes users see are unchanged.

- Normalize CLI error wording to the canonical Error: format (#439)

  Single-line error messages from the `nmr` and `release-kit` commands now print in one uniform shape, so the same class of failure reads the same way no matter which command produced it. Previously the wording varied, which made error output harder to scan and harder for scripts to match against. Richer output, such as multi-line validation reports and the stack trace from an unexpected crash, is unchanged.

## 0.4.0 — 2026-06-27

### 🎉 Features

- Centralize the per-package build as an nmr-compile bin (#419)

  Introduces `nmr-compile`, a single command shipped with `@williamthorsen/nmr` that compiles each workspace package and now backs the default build. Consuming repos can delete their own per-package build script and pick up future build fixes just by upgrading nmr. Repeated builds with unchanged source now reliably skip recompiling instead of occasionally rebuilding for no reason, and import aliases now resolve correctly in symlinked checkouts.

## 0.3.2 — 2026-05-19

### ♻️ Refactoring

- Restructure tests and align core package directory with package name (#405)

  Tests in every package are now typechecked alongside the code they cover, so type breakage in tests fails the build instead of slipping through. The `core` package's workspace directory is renamed to match its package name, so `nmr -F nmr-core ...` and `pnpm --filter nmr-core ...` now resolve where they previously failed.

## 0.3.1 — 2026-05-04

### ♻️ Refactoring

- Read package version at runtime via shared helper (#338)

  Fixes an issue where running `audit-deps`, `nmr`, or `release-kit` from the locally built `dist/esm/` after a `git pull` could report a stale version. Each CLI now reads its version directly from its `package.json` at startup, so version reads stay in sync with the installed source without requiring a fresh `pnpm install` or rebuild.

## 0.3.0 — 2026-04-23

### 🎉 Features

- Scaffold audit.yaml workflow from audit-deps init (#277)

  Adds GitHub Actions workflow scaffolding to `audit-deps init`. Running the command now writes both `.config/audit-deps.config.json` and `.github/workflows/audit.yaml` in the target repo, so that consumers no longer have to copy the canonical caller workflow by hand from this repo. The workflow content is shipped as a bundled template that ships to npm, and the repo's own workflow is kept byte-identical to that template via a consistency test — the canonical workflow cannot silently drift from what is published.

### ♻️ Refactoring

- 🚨 **Breaking:** Rename `node-monorepo-core` to `nmr-core` (#304)

  Renames the shared-utilities package from `@williamthorsen/node-monorepo-core` to `@williamthorsen/nmr-core`, aligning it with the repository's `nmr-*` naming convention. The package's functionality and version are unchanged; only the published name differs.

## 0.2.6 — 2026-04-15

### ⚙️ Tooling

- Enable automated publication to npm (#187)

  Prepares the repository for reliable tag-triggered npm publishing by adding missing package metadata, standardizing licensing, and introducing a readyup kit that validates publish readiness across all packages.

## 0.2.5 — 2026-04-04

### ♻️ Refactoring

- Extract shared CLI argument-parsing utility into core (#151)

  Add a schema-driven `parseArgs` function to `@williamthorsen/node-monorepo-core` that handles boolean flags, string flags (both `--flag=value` and `--flag value`), short aliases, positional collection, the `--` delimiter, and unknown-flag errors. Migrate all CLI argument-parsing sites in preflight (3 sites) and release-kit (5 sites) to use it. A companion `translateParseError` helper normalizes internal error messages for consistent user-facing output.

## 0.2.1 — 2026-03-28

### 🎉 Features

- Add shared writeFileWithCheck utility and overwrite reporting (#66)

  Extracts three duplicated `writeIfAbsent` implementations and two duplicated terminal helper sets into shared utilities in `@williamthorsen/node-monorepo-core`, then migrates all consumers (`release-kit init`, `preflight init`, `sync-labels`) to use them. All init commands now report which files were created, overwritten, skipped, or failed — including when `--force` replaces existing files.

## 0.2.0 — 2026-03-27

### 🎉 Features

- Add --quiet flag to nmr CLI (#4)

  Adds a `-q`/`--quiet` flag to the `nmr` CLI that suppresses command output on success while preserving full output on failure. When quiet mode is active, `runCommand()` uses `stdio: 'pipe'` to capture child process output, discards it on success, and writes captured stdout and stderr to `process.stderr` on failure. All informational messages on success paths (`console.info` calls for override script notifications) are also suppressed.

- Enable strict linting of monorepo root (#50)

  Replaces the `root:lint:strict` echo fallback with a direct `strict-lint --ignore-pattern 'packages/**' .` invocation, now that the `strict-lint` package supports the full `eslint` CLI API.

- Extract nmr CLI from core package (#61)

  Extracts all nmr CLI code from `packages/core` into a new `packages/nmr` package (`@williamthorsen/nmr`). Core is reduced to an empty shared-library shell ready for cross-cutting utilities. All internal references are rewired and the full build/test pipeline passes.

  Scopes: core, nmr

### ♻️ Refactoring

- Replace dist bin targets with thin wrapper scripts (#48)

  The `bin` entries in `packages/core` and `packages/release-kit` pointed directly into `dist/esm/`, causing `pnpm install` to emit "Failed to create bin" warnings in fresh worktrees where `dist/` does not yet exist. Each bin entry now points to a committed wrapper script in `bin/` that dynamically imports the real entry point. The `files` field in both packages includes `bin` so the wrappers are published.

### ⚙️ Tooling

- Adopt nmr to run monorepo and workspace scripts (#38)

  Replaces the legacy workspace script runner and ~25 root `package.json` scripts with `nmr`, the monorepo's own context-aware script runner. Root scripts are reduced to 4 (`prepare`, `postinstall`, `ci`, `bootstrap`), packages use direct build commands for bootstrap, and release-kit declares tier-3 test overrides for its integration test configs.

### 📦 Dependencies

- Remove vitest optional peer dependency (#46)

  Removes the `peerDependencies` and `peerDependenciesMeta` entries for vitest from `packages/core/package.json` and regenerates the lockfile to eliminate the stale `vitest@4.1.0` resolution.

  The peer dependency caused pnpm to resolve a stale `vitest@4.1.0` in the lockfile, conflicting with the root-pinned `vitest@4.1.1` and breaking coverage runs with a mixed-versions error. Consumers of the `./tests` export already provide vitest as a root devDependency, so the declaration was unnecessary.

## 0.1.0 — 2026-03-12

### 🎉 Features

- Implement nmr CLI and core package (#2)

  Adds the `@williamthorsen/node-monorepo-core` package, implementing the `nmr` CLI tool for unified script execution across a PNPM monorepo. Removes all example/template packages that were scaffolding from the original template repository.

<!-- Generated by release-kit. Do not edit this file. Use .meta/changelog-overrides.json to override entries. -->
