# @williamthorsen/nmr

Context-aware script runner for PNPM monorepos. Ships an `nmr` (node-monorepo run) binary that provides centralized, consistent script execution across workspace packages and the monorepo root.

<!-- section:release-notes --><!-- /section:release-notes -->

## Installation

Requires Node.js 24.16 or later.

```bash
pnpm add -D @williamthorsen/nmr
```

### Making `nmr` resolvable

nmr installs as a workspace bin, so the bare `nmr` command works only when your shell can find `<root>/node_modules/.bin/nmr`. Choose one:

- **[direnv](https://direnv.net/)** (recommended for contributors). Add `PATH_add node_modules/.bin` to the repo's `.envrc`, and bare `nmr` works from any subdirectory.
- **`pnpm exec nmr <command>`**. Works with no setup: pnpm resolves the bin from the workspace root.

> **Note:** Avoid `npx nmr`. Inside a git worktree, `npx` can resolve a different nmr binary from outside the working tree, so the command succeeds while running the wrong code.

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
nmr ci            # Run build && check:strict && audit (full CI pipeline)
```

nmr detects where you are and selects the right scripts automatically — see [context-aware resolution](#context-aware-resolution) below.

## Context-aware resolution

nmr's key feature is that the same command runs different scripts depending on where you invoke it. It walks up from your current directory to find `pnpm-workspace.yaml`, then checks whether your CWD is inside a workspace package directory.

| Where you run `nmr`               | Registry used     | Working directory | `nmr test` runs                               |
| --------------------------------- | ----------------- | ----------------- | --------------------------------------------- |
| Monorepo root                     | Root scripts      | Monorepo root     | Root tests + `pnpm --recursive exec nmr test` |
| Inside a workspace package        | Workspace scripts | The package root  | `pnpm exec vitest` (for that package only)    |
| Anywhere, with `--workspace-root` | Root scripts      | Monorepo root     | Root tests + `pnpm --recursive exec nmr test` |

A script always runs in the directory its registry belongs to — root scripts at the monorepo root, workspace scripts at the package root — never in the subdirectory you happened to be standing in. Scripts are written against that directory, so this is what makes `.` and other relative paths mean the same thing wherever you invoke them from.

Use `--workspace-root` to escape package context:

```bash
# From inside packages/nmr-core, run the root check suite
nmr --workspace-root check
```

Two consequences worth knowing:

- `nmr --workspace-root clean` sweeps every workspace package, exactly as `nmr clean` does from the root. It does not clean only the package you are standing in.
- Relative paths in passthrough arguments resolve against the script's directory, not your shell's. From `packages/nmr/src/`, `nmr fmt foo.ts` targets `packages/nmr/foo.ts`.

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

Passthrough arguments attach to the final step alone, because the expansion is a single shell chain: `nmr fix --dry-run` runs `nmr lint && nmr fmt --dry-run`.

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

## Pre and post hooks

Every `nmr X` invocation auto-wraps as the equivalent of `nmr X:pre && nmr X && nmr X:post`. Hooks are first-class scripts that resolve through the same three tiers as any other script (built-in defaults, then `.config/nmr.config.ts`, then per-package `package.json`). Wrapping is uniform: nested invocations from composite expansion get their own hook treatment. Hook failure short-circuits the chain via shell `&&` semantics, propagating the failing exit code.

Behaviors worth knowing:

- **Silent when absent**: Missing hooks produce no error and no output.
- **Skip overrides apply to hooks**: A hook value of `""` or `":"` is treated the same as not defining the hook, with no console message.
- **Skipping the main command skips its hooks**: When `X` is overridden to `""` or `":"`, neither `X:pre` nor `X:post` fires.
- **Recursion guard**: Direct invocation of a hook (e.g. `nmr build:pre`) is treated as a leaf operation. It does not itself attempt to resolve `build:pre:pre` or `build:pre:post`.
- **Passthrough args attach only to the main command**: `nmr X --flag value` runs hooks without `--flag value`.

Extend `nmr build` with a pre-build step for every workspace package:

```ts
// .config/nmr.config.ts
import { defineConfig } from '@williamthorsen/nmr';

export default defineConfig({
  workspaceScripts: {
    'build:pre': 'npx rdy compile',
  },
});
```

Attach a post-build step to one package:

```jsonc
// packages/nmr/package.json
{
  "scripts": {
    "build:post": "nmr-sync-agent-files",
  },
}
```

The second example calls the bin directly, which sidesteps the workspace-versus-root registry distinction.

## Dependency upgrades

`nmr upgrade` reports the dependency upgrades available to your repo. What it covers depends on where you run it:

| Invocation                   | Covers                                      |
| ---------------------------- | ------------------------------------------- |
| `nmr upgrade` (from root)    | the root `package.json` and every workspace |
| `nmr upgrade` (in a package) | that package                                |
| `nmr -F <package> upgrade`   | that package, from anywhere                 |
| `nmr root:upgrade`           | the root `package.json` alone               |

`nmr upgrade` from the root precedes its report with any active `pnpm.overrides` declared in the root `package.json`; `nmr root:upgrade` does not. An override pins a transitive dependency, so an upgrade masked by one never appears in the report.

The upgrade tool ([taze](https://github.com/antfu-collective/taze)) arrives with nmr, so your repo declares no dependency on it. Everything after the command name is passed through, including the range mode:

```bash
nmr upgrade          # upgrades available within each package's version ceilings
nmr upgrade major    # major upgrades, still inside the ceilings
nmr upgrade --write  # apply the proposals to package.json
```

### Configuring upgrades

Declare version ceilings in a `taze.config.ts` at the monorepo root:

```ts
import { defineConfig } from '@williamthorsen/nmr/taze';

export default defineConfig({
  packageMode: {
    // Hold @types/node at the Node major your `engines` floor requires.
    '@types/node': 'minor',
  },
});
```

`defineConfig` supplies nmr's shared upgrade policy — currently a seven-day quarantine on brand-new releases — so your config carries only what is specific to your repo. Any setting you declare wins over nmr's default. Passing `undefined` clears a default rather than falling back to it, which is how you hand the quarantine policy back to `pnpm-workspace.yaml`'s `minimumReleaseAge`.

Everything the [taze configuration](https://github.com/antfu-collective/taze#config-file) accepts is accepted here.

> **Note:** `--include-locked` is part of both registry entries because a repo that pins dependencies to exact versions (pnpm's `savePrefix: ''`) has no dependency the tool would otherwise consider — without it, an upgrade pass reports nothing at all. Drop it via `.config/nmr.config.ts` if your repo declares version ranges instead.

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
| `upgrade`       | `nmr-taze --include-locked`                              |
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
| `ci`    | `build`, `check:strict`, `audit`  |
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

| Command   | Runs                                                            |
| --------- | --------------------------------------------------------------- |
| `upgrade` | `nmr-report-overrides && nmr-taze --include-locked --recursive` |

See [dependency upgrades](#dependency-upgrades) for the workflow and its configuration.

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
| `root:upgrade`     | `nmr-taze --include-locked`                                   |

#### Utilities

| Command            | Runs                   |
| ------------------ | ---------------------- |
| `report-overrides` | `nmr-report-overrides` |
| `sync-agent-files` | `nmr-sync-agent-files` |

## CLI reference

### `nmr`

```
nmr [flags] <command> [args...]
```

Position determines ownership: flags before the command name are nmr's own, and everything after the command name is forwarded untouched to the resolved command.

| Flag                     | Description                                         | Default |
| ------------------------ | --------------------------------------------------- | ------- |
| `-F, --filter <pattern>` | Run command in matching packages                    | —       |
| `-R, --recursive`        | Run command in all packages                         | —       |
| `-w, --workspace-root`   | Use root scripts, running at the monorepo root      | —       |
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
nmr ci                      # build + check:strict + audit

# Target specific packages
nmr --filter core test      # Test only the core package
nmr --recursive lint        # Lint all workspace packages

# Force root context from anywhere
nmr --workspace-root check  # Run root check from a package dir
```

## Additional subcommands

These commands are available as `nmr` subcommands and as standalone `nmr-`-prefixed binaries (for use in lifecycle hooks).

### `report-overrides`

Report any active `pnpm.overrides` in the root `package.json`, reminding developers of overrides that may need cleanup. The root `upgrade` script runs it automatically, so no per-repo wiring is needed. Invoking it directly is useful for a one-off report.

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

#### What belongs in the synced file

The synced file is injected at launch in every consuming repo, so every line is paid for on every task whether or not it is relevant. It is a cheatsheet, not a manual.

A line earns a place in `AGENTS.md` only if both hold:

1. It is absent from nmr's own output. Bare `nmr` already prints the flags, every command, and the shell command each resolves to; failing checks already name their own fix. Repeating any of that costs launch tokens to say something the agent will be told anyway, at the moment it matters.
2. The obvious action goes wrong without it. Guidance that prevents a silent mistake earns its place; guidance that prevents a mistake the next error message would diagnose does not.

Everything else belongs in this README, reachable on demand at `node_modules/@williamthorsen/nmr/README.md`, with a pointer from `AGENTS.md` naming the topic so an agent knows to look. When adding a feature, document it here and extend that pointer rather than the cheatsheet.

## Standalone utilities

### `nmr-clean`

Remove a package's build output (`dist`) and its `nmr-compile` cache entry, leaving no state behind for the next build to skip on. Run from a package directory it cleans that package; run from the monorepo root it sweeps every workspace package in a single pass, running each package's resolved `clean` — so a package that overrides `clean`, in `.config/nmr.config.ts` or in its own `package.json`, gets its own command rather than the sweep. Removal is idempotent — cleaning an unbuilt package is a silent no-op. This is the default `clean` script at both levels.

```bash
nmr-clean
```

### `nmr-compile`

Compile a single package's `src` tree to `dist/esm` with the TypeScript compiler API, emitting `.js` and `.d.ts` in one pass. Because the compiler parses each source file, every relative import form — static, re-export, dynamic `import()`, and bare side-effect — is rewritten from `.ts` to `.js` in both outputs, and `.ts` occurrences inside strings and comments are left intact. tsconfig `paths` aliases are resolved to runnable relative `.js` specifiers in both outputs, sourced from the package's tsconfig. An aliased import whose target resolves outside the package's `src/` and is not resolvable without the alias mapping fails the build with a diagnostic, rather than being emitted verbatim to produce output that fails at runtime. The build is skipped when no input has changed and the previous output is still on disk (a content-and-path hash is cached under `node_modules/.cache/nmr-compile/`, outside the published output). Deleting the output by any means — `nmr clean`, `rm -rf dist`, `git clean` — therefore forces a rebuild rather than a skip. This is the default `compile` script — run it from a package directory.

`typescript` is a peer dependency (`>=5.7.0 <7`); the consuming repo provides it. The floor is what `rewriteRelativeImportExtensions` requires; the ceiling is because TypeScript 7 ships no compiler API — its root export is a version constant, so `nmr-compile` cannot run on it. Relative imports in source must carry explicit `.ts` extensions for them to be rewritten.

```bash
nmr-compile
```

### `nmr-taze`

Run the [taze](https://github.com/antfu-collective/taze) dependency-upgrade tool, forwarding every argument to it untouched. This is what `root:upgrade` resolves to, and what the root `upgrade` script ends with — see [dependency upgrades](#dependency-upgrades) for the workflow.

Under pnpm's isolated `node_modules`, a transitive package's binary is absent from the consuming repo's `node_modules/.bin`, so a repo that depends on nmr cannot run `taze` directly. `nmr-taze` can, because nmr is a direct dependency, and it resolves the tool from the tree nmr controls.

```bash
nmr-taze --include-locked --recursive
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
  "prepare": "lefthook install"
}
```

Per-package `package.json` files no longer need script entries. Run `nmr <command>` directly.

## Workspace introspection

Repo-wide tests and scripts often need to know where the monorepo root is, or which directories its workspace packages live in. The `@williamthorsen/nmr/workspace` subpath publishes the two pnpm-workspace lookups nmr uses internally:

```ts
// __tests__/packages.test.ts
import { findMonorepoRoot, getWorkspacePackageDirs } from '@williamthorsen/nmr/workspace';

const monorepoRoot = findMonorepoRoot();

for (const packageDir of getWorkspacePackageDirs(monorepoRoot)) {
  // assert something about every workspace package
}
```

`findMonorepoRoot(startDir?)` walks up from `startDir`, defaulting to `process.cwd()`, until it reaches a directory containing `pnpm-workspace.yaml`. It throws if it runs out of parent directories without finding one.

`getWorkspacePackageDirs(monorepoRoot)` reads the workspace patterns from that repo's `pnpm-workspace.yaml` and resolves them to absolute package directories, sorted and free of duplicates. Patterns carry pnpm's own semantics: `packages/*`, deeper globs such as `packages/**`, exact paths such as `tools/cli`, and `!`-prefixed exclusions such as `!packages/legacy` or `!**/test/**`, which filter every directory the positive patterns matched regardless of where they appear in the list. Nothing under `node_modules` is ever returned.

One divergence from pnpm: a directory counts as a package only if it holds a `package.json`, not a `package.yaml` or `package.json5`.

Quote exclusion patterns in the manifest — `- '!packages/legacy'`. An unquoted `!` opens a YAML tag rather than a string, so the entry never reaches nmr (or pnpm) as a pattern.
