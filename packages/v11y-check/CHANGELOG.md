# Changelog

All notable changes to this project will be documented in this file.

## 0.11.1 — 2026-07-22

### 📦 Dependencies

- Upgrade dependencies and align the Node support policy (#483)

  All four published packages (`nmr`, `nmr-core`, `release-kit`, and `v11y-check`) now require Node.js 24 or later, up from Node 18.17. Separately, `nmr-compile` now rebuilds when the TypeScript version changes.

## 0.11.0 — 2026-07-13

### 🎉 Features

- 🚨 **Breaking:** Fail a package that declares types but ships none (#467)

  `nmr attw` now fails a package that claims to ship type declarations but ships none. Such a package used to pass, leaving every TypeScript consumer of it silently typed as `any`.

  A package that ships working declarations found only by sitting beside its JavaScript entry point escapes the check, since it declares nothing. Add a `types` entry to bring it under the check.

## 0.10.0 — 2026-07-01

### 🎉 Features

- 🚨 **Breaking:** Rebuild nmr-compile on a unified tsc emit (#455)

  `nmr` now compiles a package's JavaScript and type declarations in one step, rewriting every import form — static, re-export, dynamic `import()`, bare side-effect, and tsconfig `paths` aliases — to runnable `.js` in both outputs. It now requires TypeScript 5.7 or newer as a peer dependency.

## 0.9.0 — 2026-06-30

### 🎉 Features

- 🚨 **Breaking:** Auto-activate integration test variant from config presence (#448)

  A package can now separate its integration tests from its standalone suite simply by including a `vitest.integration.config.ts` (alongside a `vitest.standalone.config.ts`). The `--int-test` flag that previously enabled this is removed — that config-file pairing is now the only way to activate the separation. In such a package, `test` and `test:coverage` run only the standalone suite and skip integration tests, while a new `test:all` runs both suites together. The separation now holds even when tests run across every package at once, so a full-workspace `test` run still keeps integration tests out of the default suite. Packages that previously hand-copied these test scripts no longer need to.

### 🐛 Bug fixes

- Prevent CLI output truncation when piped before exit (#446)

  Fixes an issue where large output from the `nmr` and `v11y` commands could be truncated when captured through a pipe — for example, by a CI job.

## 0.8.0 — 2026-06-27

### 🎉 Features

- Centralize the per-package build as an nmr-compile bin (#419)

  Introduces `nmr-compile`, a single command shipped with `@williamthorsen/nmr` that compiles each workspace package and now backs the default build. Consuming repos can delete their own per-package build script and pick up future build fixes just by upgrading nmr. Repeated builds with unchanged source now reliably skip recompiling instead of occasionally rebuilding for no reason, and import aliases now resolve correctly in symlinked checkouts.

## 0.7.1 — 2026-05-19

### ♻️ Refactoring

- Restructure tests and align core package directory with package name (#405)

  Tests in every package are now typechecked alongside the code they cover, so type breakage in tests fails the build instead of slipping through. The `core` package's workspace directory is renamed to match its package name, so `nmr -F nmr-core ...` and `pnpm --filter nmr-core ...` now resolve where they previously failed.

## 0.7.0 — 2026-05-10

### 🎉 Features

- Rename audit-deps to v11y-check (#383)

  The package previously published as `@williamthorsen/audit-deps` has been renamed to `v11y-check`. The CLI command is now `v11y-check`, and the default config file is `.config/v11y-check.config.json`. Existing users should install `v11y-check` in place of `@williamthorsen/audit-deps`, rename their config file, and update any scripts that invoke `audit-deps`. Behavior is unchanged.

## 0.6.1 — 2026-05-04

### ♻️ Refactoring

- Read package version at runtime via shared helper (#338)

  Fixes an issue where running `audit-deps`, `nmr`, or `release-kit` from the locally built `dist/esm/` after a `git pull` could report a stale version. Each CLI now reads its version directly from its `package.json` at startup, so version reads stay in sync with the installed source without requiring a fresh `pnpm install` or rebuild.

### 📚 Documentation

- Clarify which vulnerabilities `audit-deps sync` adds (#363)

  Clarifies the action hints printed by `audit-deps check` so users understand exactly which vulnerabilities `audit-deps sync` will allowlist. The hints now read "add **the listed** vulnerabilities to the allowlist", tying the action to the report shown immediately above. The previous wording — "add vulnerabilities to the allowlist" — could imply that `sync` is selective or interactive, when in fact it non-interactively allowlists every unallowed vulnerability in the report.

## 0.6.0 — 2026-04-30

### 🎉 Features

- Add status indicator to standing-issue title (#335)

  Adds a status indicator and bot-origin emoji to the standing issue maintained by the dependency-audit workflow. The title now reflects the most severe finding category and is refreshed on every run — `🤖 Dependency audit status: 3 vulnerabilities found 🚨`, `🤖 Dependency audit status: no vulnerabilities ✅`, and so on. Status priority is severity-driven: unallowed vulnerabilities outrank suppressed entries, which outrank stale allowlist entries.

## 0.5.0 — 2026-04-23

### 🎉 Features

- Show below-threshold vulnerabilities and threshold in check output (#244)

  Surfaces below-threshold vulnerabilities in the check command's output instead of silently hiding them. When the severity threshold is above `low`, vulnerabilities that fall below it now appear with an `ℹ️` marker and "ignored" annotation in bare output, full advisory detail in verbose output, and a distinct `belowThreshold` array in JSON output. Scope headers display the active threshold (e.g., `📦 prod (threshold: 🟠 moderate):`) so users can see what filtering is in effect. The "No known vulnerabilities found" message now only appears when there are truly zero vulnerabilities across all categories. Exit code behavior is unchanged — only above-threshold, non-allowlisted vulnerabilities cause failure.

- 🚨 **Breaking:** Replace --only with --tags on release-kit publish and push (#273)

  `release-kit publish` and `release-kit push` now filter by full tag name via `--tags=<tag1,tag2>` instead of workspace directory name via `--only=<dir>`, matching the shape already used by `create-github-release`. Callers pass the tag they care about (e.g., `core-v1.3.0`) directly, with no translation step back to the publishing workspace's directory name. The reusable workflow gains an optional `tags:` input, and the internal `publish.yaml` caller now passes `tags: ${{ github.ref_name }}`, making the publish scope explicit rather than relying on the single-tag fetch default of `actions/checkout@v6`.

- Scaffold audit.yaml workflow from audit-deps init (#277)

  Adds GitHub Actions workflow scaffolding to `audit-deps init`. Running the command now writes both `.config/audit-deps.config.json` and `.github/workflows/audit.yaml` in the target repo, so that consumers no longer have to copy the canonical caller workflow by hand from this repo. The workflow content is shipped as a bundled template that ships to npm, and the repo's own workflow is kept byte-identical to that template via a consistency test — the canonical workflow cannot silently drift from what is published.

### ♻️ Refactoring

- 🚨 **Breaking:** Rename `node-monorepo-core` to `nmr-core` (#304)

  Renames the shared-utilities package from `@williamthorsen/node-monorepo-core` to `@williamthorsen/nmr-core`, aligning it with the repository's `nmr-*` naming convention. The package's functionality and version are unchanged; only the published name differs.

## 0.4.0 — 2026-04-17

### 🎉 Features

- Allow audit-deps to work without a config (#235)

  Adds a no-config mode to `audit-deps` so `npx @williamthorsen/audit-deps` produces a useful vulnerability report in any repo without requiring a config file. Replaces the four confusing severity booleans with a single `severityThreshold` field: `critical`, `high`, `moderate`, or `low`. Adds a JSON Schema to the generated configs.

- Store full ISO 8601 datetime in `addedAt` (#236)

  Replaces the ambiguous `YYYY-MM-DD` date-only string in allowlist `addedAt` fields with a full ISO 8601 UTC datetime (e.g., `2026-04-15T14:30:00.000Z`). This removes timezone ambiguity and adds time-of-day precision for more accurate relative-time display.

- Improve DX of audit-deps bare output (#241)

  Redesigns the `audit-deps` bare output format to show GHSA IDs instead of npm-specific numeric advisory IDs, add severity text labels, and guide developers toward next steps. The new format includes an intro banner reflecting the audit scope, scope-labeled sections with emoji markers, bulleted findings with severity indicators, relative-time annotations on allowed vulnerabilities, and a unified `Actions:` footer with context-aware verbose and sync hints. Extracts shared time-formatting helpers into a dedicated module to support relative timestamps in both bare and verbose formatters.

## 0.3.0 — 2026-04-16

### 🎉 Features

- Decouple audit from CI quality gate and add audit workflow (#210)

  Dependency audit is now decoupled from the CI quality gate so that transient upstream CVEs no longer block the merging of unrelated code changes. Audit now runs in a dedicated workflow with non-blocking PR integration (acknowledgment checkbox) and a daily scheduled run that tracks results in a standing GitHub issue. A readyup kit is available to validate the new setup in consuming repos.

- Replace bare-command help with grouped check (#211)

  The bare `audit-deps` command now runs a grouped vulnerability check instead of showing help text. Each scope (prod first, then dev) shows unallowed vulnerabilities with severity indicators, allowed vulnerabilities with annotations, and stale allowlist entries flagged for cleanup. Exit code is 1 when unallowed vulnerabilities exist.

  The previous raw audit-ci passthrough moves behind `--raw`. The `report` subcommand is removed; its functionality is superseded by the new default output. `--dev`/`--prod`, `--config`, and `--json` compose with both the bare command and `--raw`.

  - Add optional `severity` field to `AuditResult` and extract it from audit-ci advisory JSON.
  - Add `checkCommand` that cross-references audit results with the config allowlist to classify vulnerabilities and detect stale entries. Forward `runReport` stderr to `process.stderr` when non-empty, matching the existing `auditCommand` pattern.
  - Add `formatCheckText` and `formatCheckJson` formatters in `format-check.ts`, with severity-to-emoji mapping (🔴 critical/high, 🟠 moderate, 🟡 low/info).
  - Extract `generateScopeConfig` to deduplicate the `generateAuditCiConfig` try/catch error-wrapping shared by `checkCommand`, `syncCommand`, and `loadAndGenerate`.
  - Route bare invocation to `checkCommand`, `--raw` to `auditCommand`.
  - Remove `reportCommand`, `showReportHelp`, and `report` from `SUBCOMMANDS`.
  - Update help text to document `--raw` and the new default behavior.
  - Cover new and modified behavior with unit tests, including severity parsing, formatter output, `checkCommand` classification and exit codes, stale-entry detection, stderr forwarding, scope ordering, and `--raw` routing.

- Verbose check output for audit-deps (#213)

  Adds a `--verbose` / `-v` flag to the default `audit-deps` check that produces a detailed per-vulnerability report — advisory title, severity, every affected dependency path, link, and description — replacing the need to chase the URL for each finding. Both bare and verbose outputs gain an `Actions:` footer that tells the user exactly which `audit-deps sync` invocation will resolve the current state, and `sync` now stamps an `addedAt` date on allowlist entries so allowed vulnerabilities carry an `allowed X ago (YYYY-MM-DD)` line when displayed in verbose mode.

### 📚 Documentation

- Align README and help text with current CLI API

  Update the Quick start and CLI reference in the `audit-deps` README to match the grouped-check default, the removal of the `report` command, and the new `--raw` flag. Remove "(CI mode)" from the `--raw` help-text description; the flag is not tied to CI environments.

## 0.2.1 — 2026-04-15

### ⚙️ Tooling

- Enable automated publication to npm (#187)

  Prepares the repository for reliable tag-triggered npm publishing by adding missing package metadata, standardizing licensing, and introducing a readyup kit that validates publish readiness across all packages.

## 0.2.0 — 2026-04-10

### 🎉 Features

- Create audit-deps wrapper to manage dependency audits (#183)

  Adds a new `@williamthorsen/audit-deps` package that wraps `audit-ci` with a typed JSON config model, per-scope (dev/prod) severity thresholds, and a sync workflow that automates allowlist management. The package provides a CLI with five commands: default audit (CI pass/fail), `report` (all vulnerabilities), `sync` (diff-based allowlist updates), `generate` (flat config regeneration), and `init` (config scaffolding).

<!-- Generated by release-kit. Do not edit this file. Use .meta/changelog-overrides.json to override entries. -->
