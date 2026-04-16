# @williamthorsen/audit-deps

Wraps [audit-ci](https://github.com/IBM/audit-ci) with a richer config model, typed JSON source of truth, and a sync workflow that automates allowlist management.

## Installation

```shell
pnpm add -D @williamthorsen/audit-deps
```

## Quick start

```shell
# Scaffold a starter config
npx audit-deps init

# Grouped vulnerability check across all scopes (default)
npx audit-deps

# Raw audit-ci passthrough
npx audit-deps --raw

# Sync allowlists with current findings
npx audit-deps sync
```

## Configuration

The source-of-truth config lives at `.config/audit-deps.config.json`:

```json
{
  "outDir": "../tmp",
  "dev": {
    "moderate": true,
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
    "high": true,
    "allowlist": []
  }
}
```

### Fields

- **`outDir`** (optional) — Directory for generated flat audit-ci config files, resolved relative to the config file's directory. Defaults to the config file's directory.
- **`dev`** / **`prod`** — Scope-specific settings:
  - **`critical`**, **`high`**, **`moderate`**, **`low`** — Severity thresholds (pass to audit-ci).
  - **`allowlist`** — Typed advisory entries with `id`, `path`, `url`, and optional `reason` and `addedAt`. `addedAt` is an ISO date (UTC, `YYYY-MM-DD`) populated automatically by `audit-deps sync` on new entries; existing entries retain whatever value they had.

## CLI reference

```
Usage: audit-deps [options]
       audit-deps <command> [options]

Commands:
  (default)            Grouped vulnerability check with severity indicators
  sync                 Synchronize allowlists with current audit findings
  generate             Regenerate flat audit-ci config files
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
