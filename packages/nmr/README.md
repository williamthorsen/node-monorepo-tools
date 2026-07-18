# @williamthorsen/nmr

Context-aware script runner for PNPM monorepos. Ships an `nmr` (node-monorepo run) binary that provides centralized, consistent script execution across workspace packages and the monorepo root.

<!-- section:release-notes --><!-- /section:release-notes -->

## Installation

```bash
pnpm add -D @williamthorsen/nmr
```

## Quick start

nmr works out of the box with no configuration. It ships with built-in scripts for common monorepo tasks.

From a package directory:

```bash
nmr test          # Run tests for the current package
nmr build         # Compile to .js and .d.ts in one pass
nmr check         # Typecheck, format check, lint check, and tests
```

From the monorepo root:

```bash
nmr test          # Run root tests + recursive workspace tests
nmr build         # Build all packages
nmr ci            # Run check:strict && build (full CI pipeline)
```

nmr detects where you are and selects the right scripts automatically — see [context-aware resolution](#context-aware-resolution) below.

## Context-aware resolution

nmr's key feature is that the same command runs different scripts depending on where you invoke it. It walks up from your current directory to find `pnpm-workspace.yaml`, then checks whether your CWD is inside a workspace package directory.

| Where you run `nmr`        | Registry used     | `nmr test` runs                               |
| -------------------------- | ----------------- | --------------------------------------------- |
| Monorepo root              | Root scripts      | Root tests + `pnpm --recursive exec nmr test` |
| Inside a workspace package | Workspace scripts | `pnpm exec vitest` (for that package only)    |
| Anywhere, with `-w` flag   | Root scripts      | Forces root registry regardless of location   |

Use `-w` to escape package context:

```bash
# From inside packages/nmr-core, run the root check suite
nmr -w check
```

## Three-tier override system

Scripts resolve through three tiers. Higher tiers override lower ones:

1. **Built-in defaults** — scripts shipped with this package
2. **Repo-wide config** — additions and overrides in `.config/nmr.config.ts`
3. **Per-package overrides** — scripts in a package's `package.json`

### Resolution example

Given the `build` command for a package that defines its own build script:

| Tier | Source                  | Value                   | Wins? |
| ---- | ----------------------- | ----------------------- | ----- |
| 1    | Built-in default        | `['compile']`           | —     |
| 2    | `.config/nmr.config.ts` | _(not set)_             | —     |
| 3    | `package.json` scripts  | `"tsx custom-build.ts"` | ✓     |

If no per-package override exists, the highest-tier value that is set wins. Set a script to `""` in `package.json` to skip it for that package.

> **Tip:** If your repo uses `eslint-plugin-package-json/valid-scripts`, empty strings are flagged as invalid. Use `":"` (the POSIX null command) instead — nmr treats it as a regular override that exits successfully and does nothing.

### Script values

Script values can be `string` or `string[]`. Arrays expand to chained `nmr` sub-invocations:

```ts
// "fix": ["lint", "fmt"]
// expands to: nmr lint && nmr fmt
```

## Configuration

Create `.config/nmr.config.ts` in the monorepo root to add or override scripts:

```ts
import { defineConfig } from '@williamthorsen/nmr';

export default defineConfig({
  workspaceScripts: {
    'copy-content': 'tsx scripts/copy-content.ts',
  },
  rootScripts: {
    'demo:catwalk': 'pnpx http-server --port=5189 demos/catwalk/',
  },
});
```

### `defineConfig` fields

| Field              | Type                                 | Description                                                    |
| ------------------ | ------------------------------------ | -------------------------------------------------------------- |
| `workspaceScripts` | `Record<string, string \| string[]>` | Scripts added or overridden in the workspace registry (tier 2) |
| `rootScripts`      | `Record<string, string \| string[]>` | Scripts added or overridden in the root registry (tier 2)      |
| `devBin`           | `Record<string, string>`             | Map binary names to source-repo replacement commands           |

All fields are optional. `workspaceScripts` and `rootScripts` values follow the same `string | string[]` convention described in [script values](#script-values).

### `devBin` — source-repo binary substitution

When developing a CLI tool inside the monorepo, the published binary may not reflect your latest source changes. `devBin` lets you map a binary name to a replacement command that runs from source:

```ts
export default defineConfig({
  devBin: {
    'my-cli': 'tsx packages/my-cli/src/cli.ts',
  },
});
```

When nmr resolves a command whose first token matches a `devBin` key, it replaces that token with the mapped command. Arguments are preserved. Relative paths in the replacement are resolved from the monorepo root.

For example, if a workspace script resolves to `my-cli --verbose`, nmr rewrites it to `tsx /absolute/path/to/packages/my-cli/src/cli.ts --verbose`.

> **Note:** Path resolution uses a heuristic: any non-flag token containing `/` is treated as a relative path. This works well for typical dev-tool commands but may incorrectly resolve URL-like values or glob patterns. Flags using `--flag=value` syntax are not resolved; use the spaced form `--flag value` for paths that need resolution.

## Default script registries

These scripts are available out of the box. Repo-wide config (tier 2) and per-package overrides (tier 3) can add to or replace any of them.

### Workspace scripts

| Command         | Runs                                                     |
| --------------- | -------------------------------------------------------- |
| `build`         | `compile`                                                |
| `check`         | `typecheck`, `fmt:check`, `lint:check`, `test`           |
| `check:strict`  | `typecheck`, `fmt:check`, `lint:strict`, `test:coverage` |
| `clean`         | `nmr-clean`                                              |
| `compile`       | `nmr-compile`                                            |
| `fix`           | `lint`, `fmt`                                            |
| `fix:check`     | `fmt:check`, `lint:check`                                |
| `fmt`           | `prettier --list-different --write .`                    |
| `fmt:check`     | `prettier --check .`                                     |
| `lint`          | `eslint --fix .`                                         |
| `lint:check`    | `eslint .`                                               |
| `lint:strict`   | `strict-lint`                                            |
| `test`          | `pnpm exec vitest`                                       |
| `test:coverage` | `pnpm exec vitest --coverage`                            |
| `test:watch`    | `pnpm exec vitest --watch`                               |
| `typecheck`     | `tsgo --noEmit`                                          |
| `view-coverage` | `open coverage/index.html`                               |

#### Integration test variant

A package gets this variant automatically when it contains a `vitest.integration.config.ts` file: `test` and `test:coverage` run the standalone (non-integration) suite, and integration tests run only when invoked explicitly. Activation is detected per package, so it applies under the recursive `nmr ci` fan-out. Opting in requires **both** `vitest.integration.config.ts` and `vitest.standalone.config.ts`, since the standalone scripts reference the latter.

| Command            | Runs                                                               |
| ------------------ | ------------------------------------------------------------------ |
| `test`             | `pnpm exec vitest --config=vitest.standalone.config.ts`            |
| `test:all`         | `pnpm exec vitest`                                                 |
| `test:coverage`    | `pnpm exec vitest --config=vitest.standalone.config.ts --coverage` |
| `test:integration` | `pnpm exec vitest --config=vitest.integration.config.ts`           |
| `test:watch`       | `pnpm exec vitest --config=vitest.standalone.config.ts --watch`    |

### Root scripts

#### Build and CI

| Command | Runs                              |
| ------- | --------------------------------- |
| `build` | `pnpm --recursive exec nmr build` |
| `ci`    | `build`, `check:strict`           |
| `clean` | `nmr-clean`                       |

#### Check and quality

| Command             | Runs                                                                          |
| ------------------- | ----------------------------------------------------------------------------- |
| `check`             | `typecheck`, `fmt:check`, `lint:check`, `test`                                |
| `check:agent-files` | `nmr-sync-agent-files --check`                                                |
| `check:strict`      | `typecheck`, `fmt:check`, `lint:strict`, `test:coverage`, `check:agent-files` |

#### Fix

| Command     | Runs                      |
| ----------- | ------------------------- |
| `fix:check` | `fmt:check`, `lint:check` |

#### Test

| Command         | Runs                                                       |
| --------------- | ---------------------------------------------------------- |
| `test`          | `nmr root:test && pnpm --recursive exec nmr test`          |
| `test:coverage` | `nmr root:test && pnpm --recursive exec nmr test:coverage` |
| `test:watch`    | `vitest --watch`                                           |

#### Typecheck

| Command     | Runs                                                        |
| ----------- | ----------------------------------------------------------- |
| `typecheck` | `nmr root:typecheck && pnpm --recursive exec nmr typecheck` |

#### Lint

| Command       | Runs                                                            |
| ------------- | --------------------------------------------------------------- |
| `lint`        | `nmr root:lint && pnpm --recursive exec nmr lint`               |
| `lint:check`  | `nmr root:lint:check && pnpm --recursive exec nmr lint:check`   |
| `lint:strict` | `nmr root:lint:strict && pnpm --recursive exec nmr lint:strict` |

#### Format

| Command     | Runs                                  |
| ----------- | ------------------------------------- |
| `fmt`       | `prettier --list-different --write .` |
| `fmt:all`   | `fmt`, `fmt:sh`                       |
| `fmt:check` | `prettier --check .`                  |
| `fmt:sh`    | `shfmt --write **/*.sh`               |

#### Audit

| Command      | Runs                      |
| ------------ | ------------------------- |
| `audit`      | `audit:prod`, `audit:dev` |
| `audit:dev`  | `pnpm exec v11y --dev`    |
| `audit:prod` | `pnpm exec v11y --prod`   |

#### Dependencies

| Command           | Runs                                     |
| ----------------- | ---------------------------------------- |
| `outdated`        | `pnpm outdated --compatible --recursive` |
| `outdated:latest` | `pnpm outdated --recursive`              |
| `update`          | `pnpm update --recursive`                |
| `update:latest`   | `pnpm update --latest --recursive`       |

#### Root-only

These scripts operate on root-level code only (not workspace packages):

| Command            | Runs                                                          |
| ------------------ | ------------------------------------------------------------- |
| `root:check`       | `root:typecheck`, `fmt:check`, `root:lint:check`, `root:test` |
| `root:lint`        | `eslint --fix --ignore-pattern 'packages/**' .`               |
| `root:lint:check`  | `eslint --ignore-pattern 'packages/**' .`                     |
| `root:lint:strict` | `strict-lint --ignore-pattern 'packages/**' .`                |
| `root:test`        | `vitest --config ./vitest.root.config.ts`                     |
| `root:typecheck`   | `tsgo --noEmit`                                               |

#### Utilities

| Command             | Runs                    |
| ------------------- | ----------------------- |
| `report-overrides`  | `nmr-report-overrides`  |
| `sync-agent-files`  | `nmr-sync-agent-files`  |
| `sync-pnpm-version` | `nmr-sync-pnpm-version` |

## CLI reference

### `nmr`

```
nmr [flags] <command> [args...]
```

| Flag                     | Description                                         | Default |
| ------------------------ | --------------------------------------------------- | ------- |
| `-F, --filter <pattern>` | Run command in matching packages                    | —       |
| `-R, --recursive`        | Run command in all packages                         | —       |
| `-w, --workspace-root`   | Force root script registry                          | —       |
| `-q, --quiet`            | Suppress info messages; show full output on failure | —       |
| `-?, --help`             | Show available commands                             | —       |
| `-V, --version`          | Show version number                                 | —       |

### Examples

```bash
# From a package directory
nmr test                    # Run workspace test script
nmr build                   # Compile to .js and .d.ts in one pass

# From the monorepo root
nmr test                    # Root tests + recursive workspace tests
nmr ci                      # check:strict + build

# Target specific packages
nmr -F core test            # Test only the core package
nmr -R lint                 # Lint all workspace packages

# Force root context from anywhere
nmr -w check                # Run root check from a package dir
```

## Additional subcommands

These commands are available as `nmr` subcommands and as standalone `nmr-`-prefixed binaries (for use in lifecycle hooks).

### `report-overrides`

Report any active `pnpm.overrides` in the root `package.json`. Useful as a `postinstall` hook to remind developers of active overrides that may need cleanup.

```bash
nmr report-overrides
```

### `sync-agent-files`

Sync the agent-facing guidance shipped with nmr into the consuming repo.

```bash
nmr sync-agent-files          # write .agents/nmr/AGENTS.md, stamped with the installed nmr version
nmr sync-agent-files --check  # verify the stamp matches; exit 1 with a fix message if not
```

Run `nmr sync-agent-files` once after upgrading nmr. The generated file is committed to the consuming repo; do not edit it by hand.

The default root `check:strict` composite includes `check:agent-files`, which runs `--check` automatically — so any CI pipeline already running `check:strict` catches drift without per-consumer wiring.

To expose the synced guidance to Claude Code sessions, add this include to the consuming repo's `.agents/PROJECT.md`:

```markdown
@nmr/AGENTS.md
```

### `sync-pnpm-version`

Synchronize the pnpm version from the root `package.json` `packageManager` field into the GitHub `code-quality.yaml` workflow file.

```bash
nmr sync-pnpm-version
```

## Standalone utilities

### `nmr-clean`

Remove a package's build output (`dist`) and its `nmr-compile` cache entry, leaving no state behind for the next build to skip on. Run from a package directory it cleans that package; run from the monorepo root it sweeps every workspace package in a single pass, running each package's resolved `clean` — so a package that overrides `clean`, in `.config/nmr.config.ts` or in its own `package.json`, gets its own command rather than the sweep. Removal is idempotent — cleaning an unbuilt package is a silent no-op. This is the default `clean` script at both levels.

```bash
nmr-clean
```

### `nmr-compile`

Compile a single package's `src` tree to `dist/esm` with the TypeScript compiler API, emitting `.js` and `.d.ts` in one pass. Because the compiler parses each source file, every relative import form — static, re-export, dynamic `import()`, and bare side-effect — is rewritten from `.ts` to `.js` in both outputs, and `.ts` occurrences inside strings and comments are left intact. tsconfig `paths` aliases are resolved to runnable relative `.js` specifiers in both outputs, sourced from the package's tsconfig. An aliased import whose target resolves outside the package's `src/` and is not resolvable without the alias mapping fails the build with a diagnostic, rather than being emitted verbatim to produce output that fails at runtime. The build is skipped when no input has changed and the previous output is still on disk (a content-and-path hash is cached under `node_modules/.cache/nmr-compile/`, outside the published output). Deleting the output by any means — `nmr clean`, `rm -rf dist`, `git clean` — therefore forces a rebuild rather than a skip. This is the default `compile` script — run it from a package directory.

`typescript` is a peer dependency (`>=5.7.0`, required for `rewriteRelativeImportExtensions`); the consuming repo provides it. Relative imports in source must carry explicit `.ts` extensions for them to be rewritten.

```bash
nmr-compile
```

### `ensure-prepublish-hooks`

Verify that all publishable workspace packages have a `prepublishOnly` script. Exits non-zero if any are missing.

```bash
ensure-prepublish-hooks
```

| Flag                  | Description                   | Default           |
| --------------------- | ----------------------------- | ----------------- |
| `--fix`               | Add missing hooks             | —                 |
| `--dry-run`           | Preview what `--fix` would do | —                 |
| `--command <command>` | Custom hook command           | `"npm run build"` |

## Consumer migration

After installing, a consuming repo's root `package.json` scripts shrink to lifecycle hooks:

```json
{
  "prepare": "lefthook install",
  "postinstall": "nmr report-overrides"
}
```

Per-package `package.json` files no longer need script entries. Run `nmr <command>` directly.

## Consistency tests

Export structural consistency checks for use in your test suite:

```ts
// __tests__/consistency.test.ts
import { runConsistencyChecks } from '@williamthorsen/nmr/tests';

runConsistencyChecks();
```

This verifies:

- pnpm version matches between `package.json` and GitHub workflow
- Node.js version matches between `.tool-versions` and GitHub workflow
