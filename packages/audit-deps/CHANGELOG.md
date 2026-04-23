# Changelog

All notable changes to this project will be documented in this file.

## [audit-deps-v0.5.0] - 2026-04-23

### Features

- Show below-threshold vulnerabilities and threshold in check output (#244)

  Surfaces below-threshold vulnerabilities in the check command's output instead of silently hiding them. When the severity threshold is above `low`, vulnerabilities that fall below it now appear with an `ℹ️` marker and "ignored" annotation in bare output, full advisory detail in verbose output, and a distinct `belowThreshold` array in JSON output. Scope headers display the active threshold (e.g., `📦 prod (threshold: 🟠 moderate):`) so users can see what filtering is in effect. The "No known vulnerabilities found" message now only appears when there are truly zero vulnerabilities across all categories. Exit code behavior is unchanged — only above-threshold, non-allowlisted vulnerabilities cause failure.

- Replace --only with --tags on release-kit publish and push (#273)

  `release-kit publish` and `release-kit push` now filter by full tag name via `--tags=<tag1,tag2>` instead of workspace directory name via `--only=<dir>`, matching the shape already used by `create-github-release`. Callers pass the tag they care about (e.g., `core-v1.3.0`) directly, with no translation step back to the publishing workspace's directory name. The reusable workflow gains an optional `tags:` input, and the internal `publish.yaml` caller now passes `tags: ${{ github.ref_name }}`, making the publish scope explicit rather than relying on the single-tag fetch default of `actions/checkout@v6`.

- Scaffold audit.yaml workflow from audit-deps init (#277)

  Adds GitHub Actions workflow scaffolding to `audit-deps init`. Running the command now writes both `.config/audit-deps.config.json` and `.github/workflows/audit.yaml` in the target repo, so that consumers no longer have to copy the canonical caller workflow by hand from this repo. The workflow content is shipped as a bundled template that ships to npm, and the repo's own workflow is kept byte-identical to that template via a consistency test — the canonical workflow cannot silently drift from what is published.

### Refactoring

- Rename `node-monorepo-core` to `nmr-core` (#304)

  Renames the shared-utilities package from `@williamthorsen/node-monorepo-core` to `@williamthorsen/nmr-core`, aligning it with the repository's `nmr-*` naming convention. The package's functionality and version are unchanged; only the published name differs.

## [audit-deps-v0.4.0] - 2026-04-17

### Features

- Allow audit-deps to work without a config (#235)

  Adds a no-config mode to `audit-deps` so `npx @williamthorsen/audit-deps` produces a useful vulnerability report in any repo without requiring a config file. Replaces the four confusing severity booleans with a single `severityThreshold` field: `critical`, `high`, `moderate`, or `low`. Adds a JSON Schema to the generated configs.

- Store full ISO 8601 datetime in `addedAt` (#236)

  Replaces the ambiguous `YYYY-MM-DD` date-only string in allowlist `addedAt` fields with a full ISO 8601 UTC datetime (e.g., `2026-04-15T14:30:00.000Z`). This removes timezone ambiguity and adds time-of-day precision for more accurate relative-time display.

- Improve DX of audit-deps bare output (#241)

  Redesigns the `audit-deps` bare output format to show GHSA IDs instead of npm-specific numeric advisory IDs, add severity text labels, and guide developers toward next steps. The new format includes an intro banner reflecting the audit scope, scope-labeled sections with emoji markers, bulleted findings with severity indicators, relative-time annotations on allowed vulnerabilities, and a unified `Actions:` footer with context-aware verbose and sync hints. Extracts shared time-formatting helpers into a dedicated module to support relative timestamps in both bare and verbose formatters.

## [audit-deps-v0.3.0] - 2026-04-16

### Documentation

- Align README and help text with current CLI API

  Update the Quick start and CLI reference in the `audit-deps` README to match the grouped-check default, the removal of the `report` command, and the new `--raw` flag. Remove "(CI mode)" from the `--raw` help-text description; the flag is not tied to CI environments.

### Features

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

## [audit-deps-v0.2.1] - 2026-04-15

### Tooling

- Enable automated publication to npm (#187)

  Prepares the repository for reliable tag-triggered npm publishing by adding missing package metadata, standardizing licensing, and introducing a readyup kit that validates publish readiness across all packages.

## [audit-deps-v0.2.0] - 2026-04-10

### Features

- Create audit-deps wrapper to manage dependency audits (#183)

  Adds a new `@williamthorsen/audit-deps` package that wraps `audit-ci` with a typed JSON config model, per-scope (dev/prod) severity thresholds, and a sync workflow that automates allowlist management. The package provides a CLI with five commands: default audit (CI pass/fail), `report` (all vulnerabilities), `sync` (diff-based allowlist updates), `generate` (flat config regeneration), and `init` (config scaffolding).

<!-- generated by git-cliff -->
