# @williamthorsen/audit-deps

Wraps [audit-ci](https://github.com/IBM/audit-ci) with a richer config model, typed JSON source of truth, and a sync workflow that automates allowlist management.

## Installation

```shell
pnpm add -D @williamthorsen/audit-deps
```

## Quick start

```shell
# Run a vulnerability check with sensible defaults (no config needed)
npx @williamthorsen/audit-deps

# Scaffold a starter config for customization
npx audit-deps init

# Sync allowlists with current findings
npx audit-deps sync

# Raw audit-ci passthrough
npx audit-deps --raw
```

No config file is required. When `.config/audit-deps.config.json` is absent, the tool uses built-in defaults: `severityThreshold: 'high'` for dev, `severityThreshold: 'moderate'` for prod, and empty allowlists.

## Configuration

The source-of-truth config lives at `.config/audit-deps.config.json`:

```json
{
  "$schema": "https://github.com/williamthorsen/node-monorepo-tools/raw/audit-deps-v0.3.0/packages/audit-deps/schemas/config.json",
  "dev": {
    "severityThreshold": "high",
    "allowlist": [
      {
        "addedAt": "2026-04-15",
        "id": "GHSA-1234-5678-abcd",
        "path": "lodash",
        "reason": "Accepted risk: no user input reaches this path",
        "url": "https://github.com/advisories/GHSA-1234-5678-abcd"
      }
    ]
  },
  "prod": {
    "severityThreshold": "moderate",
    "allowlist": []
  }
}
```

### Fields

- **`$schema`** (optional) — JSON Schema URL for editor autocomplete and validation. Automatically included by `init` and `sync`.
- **`dev`** / **`prod`** — Scope-specific settings:
  - **`severityThreshold`** (optional) — Fail on advisories at or above this severity. Valid values: `'low'`, `'moderate'`, `'high'`, `'critical'`. When omitted, audit-ci uses its own defaults.
  - **`allowlist`** — Typed advisory entries with `id`, `path`, `url`, and optional `reason` and `addedAt`. `addedAt` is an ISO date (UTC, `YYYY-MM-DD`) populated automatically by `audit-deps sync` on new entries; existing entries retain whatever value they had.

## CLI reference

```
Usage: audit-deps [options]
       audit-deps <command> [options]

Commands:
  (default)            Grouped vulnerability check with severity indicators
  sync                 Synchronize allowlists with current audit findings
  init                 Scaffold a starter config file

Scope options:
  --dev                Target dev dependencies only
  --prod               Target production dependencies only

Other options:
  --config <path>      Path to config file (default: .config/audit-deps.config.json)
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

## Migration from v0.3

v0.4 introduces breaking changes to the config schema:

- **`outDir` removed.** Intermediate audit-ci files are now written to a temp directory and cleaned up automatically. Remove `outDir` from your config.
- **Severity booleans replaced by `severityThreshold`.** Replace `"moderate": true` with `"severityThreshold": "moderate"`, `"high": true` with `"severityThreshold": "high"`, etc. Only one threshold per scope is supported.
- **`generate` subcommand removed.** The `audit-deps generate` command no longer exists. Flat audit-ci configs are now managed internally.
- **Config is optional.** All commands now work without a config file, using built-in defaults.

To migrate an existing config:

1. Remove the `outDir` field.
2. Replace severity booleans with `severityThreshold` in each scope.
3. Optionally add a `$schema` field (run `audit-deps init --force` to regenerate, or add it manually).
4. Delete any generated `audit-ci.*.json` files that were in your config directory.
