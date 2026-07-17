# v11y-check

Wraps [audit-ci](https://github.com/IBM/audit-ci) with a richer config model, typed JSON source of truth, and a sync workflow that automates allowlist management.

<!-- section:release-notes --><!-- /section:release-notes -->

## Installation

Requires Node.js 24 or later.

```shell
pnpm add -D v11y-check
```

The package is `v11y-check`; the bin is `v11y`. The package also ships `v11y-check` as a bin alias, so `pnpm exec v11y-check` and `npx v11y-check` continue to work.

## Quick start

```shell
# Run a vulnerability check with sensible defaults (no config needed)
npx v11y-check check

# Scaffold a starter config and GitHub Actions workflow
npx v11y-check init

# Sync allowlists with current findings
npx v11y-check sync

# Raw audit-ci passthrough
npx v11y-check --raw
```

No config file is required. When `.config/v11y-check.config.json` is absent, the tool uses built-in defaults: `severityThreshold: 'moderate'` for dev, `severityThreshold: 'low'` for prod, and empty allowlists.

## Configuration

The source-of-truth config lives at `.config/v11y-check.config.json`:

```json
{
  "$schema": "https://github.com/williamthorsen/node-monorepo-tools/raw/v11y-check-v<version>/packages/v11y-check/schemas/config.json",
  "dev": {
    "severityThreshold": "moderate",
    "allowlist": [
      {
        "addedAt": "2026-04-15T09:30:00.000Z",
        "id": "GHSA-1234-5678-abcd",
        "path": "lodash",
        "reason": "Accepted risk: no user input reaches this path",
        "url": "https://github.com/advisories/GHSA-1234-5678-abcd"
      }
    ]
  },
  "prod": {
    "severityThreshold": "low",
    "allowlist": []
  }
}
```

### Fields

- **`$schema`** (optional) — JSON Schema URL for editor autocomplete and validation. Automatically included by `init` and `sync`.
- **`dev`** / **`prod`** — Scope-specific settings:
  - **`severityThreshold`** (optional) — Fail on advisories at or above this severity. Valid values: `'low'`, `'moderate'`, `'high'`, `'critical'`. When omitted, audit-ci uses its own defaults.
  - **`allowlist`** — Typed advisory entries with `id`, `path`, `url`, and optional `reason` and `addedAt`. `addedAt` is an ISO 8601 UTC datetime (e.g., `2026-04-15T09:30:00.000Z`) populated automatically by `v11y sync` on new entries; existing entries retain whatever value they had. Older `YYYY-MM-DD` values are still accepted.

## CLI reference

```
Usage: v11y [options]
       v11y <command> [options]

Commands:
  check (default)      Grouped vulnerability check with severity indicators
  sync                 Synchronize allowlists with current audit findings
  init                 Scaffold a starter config file and GitHub Actions workflow

Scope options:
  --dev                Target dev dependencies only
  --prod               Target production dependencies only

Other options:
  --config <path>      Path to config file (default: .config/v11y-check.config.json)
  --json               Output results as JSON
  --raw                Run raw audit-ci passthrough
  --verbose, -v        Show detailed per-vulnerability output
  --help, -h           Show this help message
  --version, -V        Show version number
```

### Init options

```
  --dry-run, -n   Preview changes without writing files
  --force, -f     Overwrite existing files
```

### JSON output shape

`--json` emits one object per requested scope plus a top-level `summary` block:

```jsonc
{
  "prod": { "allowed": [...], "belowThreshold": [...], "stale": [...], "unallowed": [...] },
  "dev":  { "allowed": [...], "belowThreshold": [...], "stale": [...], "unallowed": [...] },
  "summary": { "status": "vulnerabilities-found", "count": 3 }
}
```

`summary.status` is the highest-severity finding category present across the requested scopes. Below-threshold findings never affect it.

| `status`                     | When                                              |
| ---------------------------- | ------------------------------------------------- |
| `vulnerabilities-found`      | At least one unallowed advisory                   |
| `suppressed-vulnerabilities` | No unallowed; at least one allowlisted advisory   |
| `stale-overrides`            | No advisories; at least one stale allowlist entry |
| `none`                       | No findings                                       |

`summary.count` is the total across the requested scopes for the active category. It is `0` when `status` is `none`.

## Scaffolded GitHub Actions workflow

`v11y init` scaffolds `.github/workflows/audit.yaml` alongside the config file. The workflow is a thin caller that delegates to the versioned reusable workflow published at `williamthorsen/node-monorepo-tools/.github/workflows/audit.reusable.yaml@workflow/audit-v1`, so your repository tracks the reusable workflow at a stable version tag.

The scaffolded workflow triggers on pull requests to `main`/`next`, on a daily schedule, and on manual `workflow_dispatch`. Commit the file into your repository so the caller runs in CI. If the reusable workflow's caller-side requirements change (for example, the tag bumps), re-run `v11y init --force` to refresh the file.

## Migration from v0.3

v0.4 introduces breaking changes to the config schema:

- **`outDir` removed.** Intermediate audit-ci files are now written to a temp directory and cleaned up automatically. Remove `outDir` from your config.
- **Severity booleans replaced by `severityThreshold`.** Replace `"moderate": true` with `"severityThreshold": "moderate"`, `"high": true` with `"severityThreshold": "high"`, etc. Only one threshold per scope is supported.
- **`generate` subcommand removed.** The `v11y generate` command no longer exists. Flat audit-ci configs are now managed internally.
- **Config is optional.** All commands now work without a config file, using built-in defaults.

To migrate an existing config:

1. Remove the `outDir` field.
2. Replace severity booleans with `severityThreshold` in each scope.
3. Optionally add a `$schema` field (run `v11y init --force` to regenerate, or add it manually).
4. Delete any generated `audit-ci.*.json` files that were in your config directory.
