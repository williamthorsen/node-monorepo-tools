# @williamthorsen/preflight

Run pre-deployment verification checks against your environment and configuration. Define checklists in TypeScript, run them locally or from a remote source, and get clear pass/fail reporting with remediation hints.

## Installation

```bash
pnpm add -D @williamthorsen/preflight
```

## Quick start

Scaffold a starter config and collection:

```bash
preflight init
```

This creates two files:

**`.config/preflight.config.ts`** — repo-level settings:

```ts
import { definePreflightConfig } from '@williamthorsen/preflight';

export default definePreflightConfig({
  compile: {
    srcDir: '.preflight/collections',
    outDir: '.preflight/collections',
  },
});
```

**`.preflight/collections/default.ts`** — a collection with one example checklist:

```ts
import { definePreflightCollection } from '@williamthorsen/preflight';

export default definePreflightCollection({
  checklists: [
    {
      name: 'deploy',
      checks: [
        {
          name: 'environment variables set',
          check: () => Boolean(process.env['NODE_ENV']),
          fix: 'Set NODE_ENV before deploying',
        },
      ],
    },
  ],
});
```

Run the checks:

```bash
preflight run
```

Output:

```
🟢 environment variables set (3ms)

🟢 1 passed (4ms)
```

If a check fails, you see the fix hint:

```
🔴 environment variables set (2ms)

🔴 1 failed (3ms)

Fixes:
  Set NODE_ENV before deploying
```

### Check-result legend

| Icon | Meaning                         |
| ---- | ------------------------------- |
| 🟢   | Passed                          |
| 🔴   | Failed                          |
| ⛔   | Skipped (a precondition failed) |

## Configuration

### Config file location

Preflight looks for a config file at `.config/preflight.config.ts`. If it does not exist, defaults are used. The config controls compilation settings:

```ts
interface PreflightConfig {
  compile?: {
    srcDir?: string; // default: '.preflight/collections'
    outDir?: string; // default: '.preflight/collections'
    include?: string; // glob pattern to filter files during batch compile
  };
}
```

### Config authoring API

All helpers are type-safe identity functions that provide editor autocomplete without runtime overhead. Import them from `@williamthorsen/preflight`.

#### `definePreflightConfig`

Define repo-level settings:

```ts
import { definePreflightConfig } from '@williamthorsen/preflight';

export default definePreflightConfig({
  compile: {
    srcDir: '.preflight/collections',
    outDir: '.preflight/collections',
    include: 'shared/*.ts',
  },
});
```

#### `definePreflightCollection`

Define a collection of checklists with optional suites and fix placement:

```ts
import { definePreflightCollection } from '@williamthorsen/preflight';

export default definePreflightCollection({
  fixLocation: 'INLINE',
  checklists: [
    /* ... */
  ],
  suites: {
    critical: ['auth', 'database'],
  },
});
```

#### `definePreflightChecklist`

Define a flat checklist. All checks run concurrently:

```ts
import { definePreflightChecklist } from '@williamthorsen/preflight';

const checklist = definePreflightChecklist({
  name: 'deploy',
  preconditions: [{ name: 'CI is green', check: () => process.env['CI_STATUS'] === 'green' }],
  checks: [
    {
      name: 'environment variables set',
      check: () => Boolean(process.env['NODE_ENV']),
      fix: 'Set NODE_ENV before deploying',
    },
    {
      name: 'database reachable',
      check: async () => {
        const ok = await pingDatabase();
        return { ok, detail: ok ? 'connected' : 'timeout' };
      },
      fix: 'Check DATABASE_URL and network access',
    },
  ],
});
```

#### `definePreflightStagedChecklist`

Define a staged checklist. Groups run sequentially; checks within each group run concurrently. Use this when later checks depend on earlier ones passing:

```ts
import { definePreflightStagedChecklist } from '@williamthorsen/preflight';

const checklist = definePreflightStagedChecklist({
  name: 'release',
  groups: [
    // Group 1: prerequisites
    [
      { name: 'on main branch', check: () => getCurrentBranch() === 'main' },
      { name: 'clean working tree', check: () => isCleanWorkingTree() },
    ],
    // Group 2: runs only if group 1 passes
    [
      { name: 'tests pass', check: async () => runTests() },
      { name: 'build succeeds', check: async () => runBuild() },
    ],
  ],
});
```

#### `defineChecklists`

Type-safe wrapper for an array of checklists (flat or staged). Useful when defining checklists separately from the collection:

```ts
import { defineChecklists } from '@williamthorsen/preflight';

const checklists = defineChecklists([deployChecklist, releaseChecklist]);
```

### Check return values

A check function can return a `boolean` or a `CheckOutcome` object:

| Return type    | Fields      | Description                                                                  |
| -------------- | ----------- | ---------------------------------------------------------------------------- |
| `boolean`      | —           | `true` = passed, `false` = failed                                            |
| `CheckOutcome` | `ok`        | `true` = passed, `false` = failed                                            |
|                | `detail?`   | Additional status info shown in the report                                   |
|                | `progress?` | `{ type: 'fraction', passedCount, count }` or `{ type: 'percent', percent }` |

### Preconditions

Both flat and staged checklists accept a `preconditions` array. Preconditions run before the main checks. If any precondition fails, all remaining checks in the checklist are skipped (reported as ⛔).

### Fix location

Control where fix messages appear in the human-readable output:

| Value             | Behavior                                                   |
| ----------------- | ---------------------------------------------------------- |
| `'END'` (default) | Fix messages collected in a "Fixes:" section at the bottom |
| `'INLINE'`        | Fix messages appear directly below each failed check       |

Set `fixLocation` on a collection (applies to all checklists) or on an individual checklist (overrides the collection setting).

### Suites

Group checklists by name for convenient invocation:

```ts
export default definePreflightCollection({
  checklists: [authChecklist, dbChecklist, cacheChecklist],
  suites: {
    critical: ['auth', 'database'],
    full: ['auth', 'database', 'cache'],
  },
});
```

```bash
preflight run critical        # Runs auth + database checklists
preflight run full            # Runs all three
preflight run auth database   # Same as "critical", by checklist name
```

## Sharing checks across repos

Preflight supports distributing checks as pre-compiled JavaScript bundles that any repo can fetch and run without installing your config as a dependency.

```
author .ts collection
        │
        ▼
  preflight compile
        │
        ▼
  self-contained .js bundle
        │
        ▼
  push to repository
        │
        ▼
  preflight run --github org/repo
```

### 1. Author a collection

Write your collection in TypeScript under `.preflight/collections/`:

```ts
// .preflight/collections/default.ts
import { definePreflightCollection } from '@williamthorsen/preflight';

export default definePreflightCollection({
  checklists: [
    /* shared checks */
  ],
});
```

### 2. Compile

Bundle the TypeScript into a self-contained ESM file with all dependencies inlined (except Node built-ins):

```bash
preflight compile .preflight/collections/default.ts
# Produces .preflight/collections/default.js
```

Or compile all sources from the config's `srcDir` at once:

```bash
preflight compile
```

Use `compile.include` in your config to filter which files are compiled:

```ts
export default definePreflightConfig({
  compile: {
    srcDir: '.preflight/collections',
    outDir: '.preflight/collections',
    include: 'shared/*.ts', // only compile files matching this glob
  },
});
```

### 3. Test locally before pushing

Use `--local` to test a compiled collection from another repository on your filesystem:

```bash
preflight run --local ../shared-checks-repo
# Loads ../shared-checks-repo/.preflight/collections/default.js

preflight run --local ../shared-checks-repo --collection production
# Loads ../shared-checks-repo/.preflight/collections/production.js
```

### 4. Commit and push

Commit the compiled `.js` files. Consumers fetch them via raw URL.

### 5. Consume remotely

From any repo:

```bash
# Fetch from GitHub (uses GITHUB_TOKEN or gh auth token automatically)
preflight run --github myorg/shared-checks

# Fetch a specific ref
preflight run --github myorg/shared-checks@v2.0

# Fetch a named collection
preflight run --github myorg/shared-checks --collection production

# Fetch from any URL
preflight run --url https://example.com/preflight/default.js
```

The `--github` flag constructs the URL: `https://raw.githubusercontent.com/{org}/{repo}/{ref}/.preflight/collections/{collection}.js`

## CLI reference

`run` is the default command. These two invocations are equivalent:

```bash
preflight run deploy --file checks.ts
preflight deploy --file checks.ts
```

When the first argument is not a recognized subcommand (`run`, `compile`, `init`) or a global flag, preflight treats the entire argument list as `run` arguments. If the argument looks like a mistyped subcommand (e.g., `preflight compil`), preflight suggests the correct spelling.

### Global options

| Flag            | Description         |
| --------------- | ------------------- |
| `--help, -h`    | Show help message   |
| `--version, -V` | Show version number |

### `preflight run`

Run preflight checklists. If no names are given, all checklists in the collection are run.

```
preflight run [names...] [options]
```

| Flag                            | Description                                | Default     |
| ------------------------------- | ------------------------------------------ | ----------- |
| `--file, -f <path>`             | Path to a local collection file            | —           |
| `--github, -g <org/repo[@ref]>` | Fetch collection from a GitHub repository  | —           |
| `--local, -l <path>`            | Load compiled collection from a local repo | —           |
| `--url, -u <url>`               | Fetch collection from a URL                | —           |
| `--collection, -c <name>`       | Collection name                            | `default`   |
| `--json, -j`                    | Output results as JSON                     | —           |
| `--fail-on, -F <severity>`      | Fail on this severity or above             | `error`     |
| `--report-on, -R <severity>`    | Report this severity or above              | `recommend` |

`--file`, `--github`, `--local`, and `--url` are mutually exclusive. When none is given, preflight loads `.preflight/collections/default.ts` (or the named collection via `--collection`).

`--collection` accepts relative paths (e.g., `--collection shared/deploy` resolves to `.preflight/collections/shared/deploy.ts`).

`[names...]` can be checklist names, suite names, or a mix.

### `preflight compile`

Bundle TypeScript collection(s) into self-contained ESM file(s).

```
preflight compile [<file>] [options]
```

| Flag                  | Description                              | Default                       |
| --------------------- | ---------------------------------------- | ----------------------------- |
| `<file>`              | Input TypeScript file                    | —                             |
| `--output, -o <path>` | Output file path (single-file mode only) | Input path with `.ts` → `.js` |

If no file is given, all sources from the config's `srcDir` are compiled.

### `preflight init`

Scaffold a starter config and collection.

```
preflight init [options]
```

| Flag            | Description                           |
| --------------- | ------------------------------------- |
| `--dry-run, -n` | Preview changes without writing files |
| `--force, -f`   | Overwrite existing files              |

Creates `.config/preflight.config.ts` and `.preflight/collections/default.ts`.

### Error messages

When an uncompiled collection references a package that is not installed, preflight explains that the package must be a project dependency and suggests `preflight compile` as an alternative for self-contained bundles.

## JSON output

Use `--json` to get machine-readable output:

```bash
preflight run --json
```

```json
{
  "allPassed": false,
  "passedCount": 2,
  "failedCount": 1,
  "skippedCount": 0,
  "durationMs": 45,
  "checklists": [
    {
      "name": "deploy",
      "allPassed": false,
      "durationMs": 45,
      "passedCount": 2,
      "failedCount": 1,
      "skippedCount": 0,
      "checks": [
        {
          "name": "environment variables set",
          "status": "passed",
          "durationMs": 3
        },
        {
          "name": "database reachable",
          "status": "passed",
          "durationMs": 38,
          "detail": "connected"
        },
        {
          "name": "feature flags loaded",
          "status": "failed",
          "durationMs": 4,
          "fix": "Check FEATURE_FLAGS_URL",
          "error": "Connection refused"
        }
      ]
    }
  ]
}
```

Optional fields (`fix`, `error`, `detail`, `progress`) are omitted when not present.
