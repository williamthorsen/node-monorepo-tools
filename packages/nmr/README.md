# @williamthorsen/nmr

Context-aware script runner for pnpm monorepos. Ships an `nmr` (node-monorepo run) binary that provides centralized, consistent script execution across workspace packages and the monorepo root.

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

| Where you run `nmr`               | Registry used     | Working directory | `nmr test` runs                                                 |
| --------------------------------- | ----------------- | ----------------- | --------------------------------------------------------------- |
| Monorepo root                     | Root scripts      | Monorepo root     | Root tests + `pnpm --recursive exec nmr test`                   |
| Inside a workspace package        | Workspace scripts | The package root  | `pnpm exec vitest --project '!integration'` (that package only) |
| Anywhere, with `--workspace-root` | Root scripts      | Monorepo root     | Root tests + `pnpm --recursive exec nmr test`                   |

Relative paths in a script resolve against that working directory, not the invocation directory.

Use `--workspace-root` to escape package context:

```bash
# From inside packages/nmr-core, run the root check suite
nmr --workspace-root check
```

Two consequences:

- `nmr --workspace-root clean` sweeps every workspace package, as `nmr clean` does from the root.
- Passthrough paths resolve against the working directory: from `packages/nmr/src/`, `nmr --workspace-root fmt pnpm-workspace.yaml` formats the file at the monorepo root.

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

| Command            | Runs                                                     |
| ------------------ | -------------------------------------------------------- |
| `build`            | `compile`                                                |
| `check`            | `typecheck`, `fmt:check`, `lint:check`, `test`           |
| `check:strict`     | `typecheck`, `fmt:check`, `lint:strict`, `test:coverage` |
| `clean`            | `nmr-clean`                                              |
| `compile`          | `nmr-compile`                                            |
| `fix`              | `lint`, `fmt`                                            |
| `fix:check`        | `fmt:check`, `lint:check`                                |
| `fmt`              | `nmr-fmt --write`                                        |
| `fmt:check`        | `nmr-fmt --check`                                        |
| `lint`             | `eslint --fix .`                                         |
| `lint:check`       | `eslint .`                                               |
| `lint:strict`      | `strict-lint`                                            |
| `test`             | `pnpm exec vitest --project '!integration'`              |
| `test:all`         | `pnpm exec vitest`                                       |
| `test:coverage`    | `pnpm exec vitest --project '!integration' --coverage`   |
| `test:integration` | `pnpm exec vitest --project integration`                 |
| `test:watch`       | `pnpm exec vitest --project '!integration' --watch`      |
| `typecheck`        | `tsgo --noEmit`                                          |
| `upgrade`          | `nmr-taze --include-locked`                              |
| `view-coverage`    | `open coverage/index.html`                               |

`fmt` and `fmt:check` select their files through git rather than by walking the directory, which is what makes a package-level run and a root-level run apply the same ignore rules — see [file selection](#file-selection).

#### Test selections

Every package resolves the same five test commands. Nothing is detected on disk: the commands select [Vitest projects](#shared-vitest-config), so a package separates its integration tests by naming them `*.int.test.ts`, not by carrying extra config files.

| To run                              | Command            |
| ----------------------------------- | ------------------ |
| Everything except integration tests | `test`             |
| Integration tests alone             | `test:integration` |
| Every project                       | `test:all`         |

`test` negates `integration` rather than naming the code-only projects, so a category added later joins the default run instead of being dropped from it.

`test:coverage` and `test:watch` are the same selection as `test` in a different mode. There are no `test:integration --coverage` equivalents because none are needed: everything after a command name is forwarded untouched, so `nmr test:integration --coverage` already works.

To narrow to a single project, go through `test:all`: `nmr test:all --project app`. Narrowing through `test` does not work, because a second `--project` widens the filter rather than restricting it.

A run that collects no test files passes. That is what lets `nmr test:integration` fan out across a monorepo in which most packages have no integration tests, and it means a package with no tests at all needs no `"test": ""` override.

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

The same five names the workspace registry carries, so a command means the same thing from the monorepo root as from inside a package. Each fans out to root-level files and every workspace package.

| Command            | Runs                                                                      |
| ------------------ | ------------------------------------------------------------------------- |
| `test`             | `nmr root:test && pnpm --recursive exec nmr test`                         |
| `test:all`         | `nmr root:test:all && pnpm --recursive exec nmr test:all`                 |
| `test:coverage`    | `nmr root:test && pnpm --recursive exec nmr test:coverage`                |
| `test:integration` | `nmr root:test:integration && pnpm --recursive exec nmr test:integration` |
| `test:watch`       | `vitest --project '!integration' --watch`                                 |

`test:coverage` chains `root:test` rather than a `root:test:coverage`, because the root config reports no coverage of its own; packages cover their own sources.

`test:watch` is the exception to the fan-out shape, and deliberately omits `--config`: bare `vitest` at the monorepo root resolves the root `vitest.config.ts`, whose projects then cover the whole tree in one process. A chain like the others would never advance past its first watcher. To watch root-level files alone, run `nmr root:test --watch`.

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

| Command     | Runs              |
| ----------- | ----------------- |
| `fmt`       | `nmr-fmt --write` |
| `fmt:check` | `nmr-fmt --check` |

#### File selection

`fmt` and `fmt:check` format the files git reports: tracked files, plus untracked files git does not ignore. Prettier reads `.gitignore` and `.prettierignore` from the working directory alone, so a pattern in `packages/<pkg>/.gitignore` never reaches a run started at the monorepo root. git knows the whole hierarchy, including `.git/info/exclude` and `core.excludesFile`, and every `.prettierignore` in the tree is discovered from the repository root, so package-level exclusions apply from any directory as well.

A file git ignores is never formatted, even when named directly. Trailing arguments are git pathspecs rather than Prettier flags, so `nmr fmt:check packages/nmr` narrows the run, while an unrecognized option and a pathspec matching no formattable file both fail it. Running outside a git repository fails rather than reporting a clean run.

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

| Command                 | Runs                                                               |
| ----------------------- | ------------------------------------------------------------------ |
| `root:check`            | `root:typecheck`, `fmt:check`, `root:lint:check`, `root:test`      |
| `root:lint`             | `eslint --fix --ignore-pattern 'packages/**' .`                    |
| `root:lint:check`       | `eslint --ignore-pattern 'packages/**' .`                          |
| `root:lint:strict`      | `strict-lint --ignore-pattern 'packages/**' .`                     |
| `root:test`             | `vitest --config ./vitest.root.config.ts --project '!integration'` |
| `root:test:all`         | `vitest --config ./vitest.root.config.ts`                          |
| `root:test:integration` | `vitest --config ./vitest.root.config.ts --project integration`    |
| `root:typecheck`        | `tsgo --noEmit`                                                    |
| `root:upgrade`          | `nmr-taze --include-locked`                                        |

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

### `nmr-fmt`

Format, or check the formatting of, the files git reports for the working directory. Exactly one of `--check` and `--write` is required; a bare invocation prints usage and exits non-zero rather than defaulting to a mutation. `--write` also lists the files it rewrote. This is what `fmt` and `fmt:check` resolve to, in both registries.

The selection is tracked files plus untracked files git does not ignore, scoped to the working directory, with every `.prettierignore` in the tree discovered from the repository root and passed to Prettier explicitly — see [file selection](#file-selection) for what that buys. Paths the index names but the filesystem does not have (a file deleted but not yet staged) and submodule gitlinks are both dropped, so neither reaches Prettier.

Trailing arguments are git pathspecs, not Prettier flags: they narrow the selection, an unrecognized option is rejected rather than forwarded, and pathspecs that match no formattable file fail rather than passing quietly.

`prettier` is an optional peer dependency (`>=3.9.5 <4`); the consuming repo provides it, and it is resolved through the module graph rather than from `PATH`, so the copy that runs is the one the repo declares and not whichever `prettier` happens to come first. A repository's formatter has to be the one its editor and pre-commit hook also run, which is why nmr takes it from the consumer instead of bundling a copy. It is optional because a repo can use nmr purely as a script runner; one that formats without a resolvable Prettier gets a message naming the package and the range.

The floor is a currency policy, not a capability boundary. What the design requires is `--ignore-path` honouring every flag rather than only the last, so a repository-root ignore file passed alongside a package-level one is not silently dropped — Prettier has done that since 3.0.0, while 2.x honoured only the final flag. The floor sits at the current release because every consuming repo tracks it; lowering it to `>=3.0.0` would cost correctness nothing.

```bash
nmr-fmt --check
nmr-fmt --write packages/nmr
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

## Shared Prettier config

Every repo consuming nmr otherwise maintains its own copy of the house Prettier options, and wires up shell formatting itself. The `@williamthorsen/nmr/prettier` subpath publishes both as a factory, so a repo declares only what it customizes:

```js
// .prettierrc.js
import { definePrettierConfig } from '@williamthorsen/nmr/prettier';

export default definePrettierConfig();
```

`prettier` is a peer dependency (`>=3.9.5 <4`), declared optional — the consuming repo provides it. The shell and Dockerfile plugin is a dependency of nmr rather than a peer, so its version is pinned centrally and two repos cannot format the same script differently.

### What it formats

Beyond everything Prettier already handles, this config formats `.sh`, `.bash`, `.zsh`, and the other extensions and dotfile names of the Shell language, plus `Dockerfile` and `Containerfile`. `nmr fmt` therefore covers shell scripts with no extra script, glob, or workflow entry.

Shell output matches `shfmt` run with no flags: `binaryNextLine`, `spaceRedirects`, and `switchCaseIndent` are pinned to shfmt's CLI defaults, which the underlying plugin inverts. A repo whose scripts shfmt already formatted sees no diff on adoption.

### Language scoping

`prettier-plugin-sh` routes 20 further file types to the same shell parser, among them `.gitignore`, `.env`, `.csh`, `.nu`, `.properties`, `.ics`, `.vcf`, `CODEOWNERS`, and `hosts`. Since `nmr fmt` hands git's whole file list to Prettier, registering the plugin as shipped would make every one of them formattable — and the shell parser either fails on them or silently rewrites them. A `.gitignore` pattern such as `a(b)c` fails to parse, and an unquoted `&` in a `.env` or `.properties` value is split across two lines.

This config registers a narrowed plugin, so Prettier infers a parser for the Shell and Dockerfile languages alone. `.flaskenv`, `gradlew`, and `mvnw` are dropped from Shell as well: the first holds dotenv content the plugin misfiles as shell, and the other two are vendored wrappers their generators would overwrite.

The parsers themselves stay registered, so a repo that wants a dropped language back assigns it explicitly:

```js
export default definePrettierConfig({
  additionalOverrides: [{ files: ['APKBUILD', '*.ebuild'], options: { parser: 'sh' } }],
});
```

### Customizing

Any Prettier option passed to the factory spreads over the defaults:

```js
export default definePrettierConfig({
  printWidth: 100,
  additionalPlugins: [await import('prettier-plugin-tailwindcss')],
  additionalOverrides: [{ files: ['*.md'], options: { proseWrap: 'always' } }],
});
```

`additionalPlugins` and `additionalOverrides` append to what the config declares, so a later override wins over nmr's own and no seam can drop shell support. Passing `plugins` or `overrides` throws, and both are typed `never` — replacement is inexpressible rather than merely discouraged, because a silently ignored key would produce no diff to notice.

### Adoption caveats

- **Indentation follows `.editorconfig`**, as it did under shfmt: Prettier maps `indent_style` and `indent_size` to `useTabs` and `tabWidth`, and the plugin honours both. With no `.editorconfig`, the two disagree — shfmt indents shell with tabs, Prettier with two spaces. Add `indent_style = tab` under `[*.sh]` to keep tabs.
- **Shell fences in Markdown are formatted**, which collapses hand-aligned comment columns in documentation. Prettier keeps the original text when an embedded snippet fails to parse, so illustrative or truncated fences are safe. Use `<!-- prettier-ignore -->` before a fence whose alignment matters.
- **Adopting the house options reformats the repo.** `singleQuote`, `trailingComma`, and the rest apply on the first run; review that diff separately from the shell one.

## Shared Vitest config

Every repo consuming nmr otherwise writes and maintains its own Vitest config. The `@williamthorsen/nmr/vitest` subpath publishes that config as a factory, so a repo declares only what it customizes:

```ts
// vitest.config.ts
import { defineVitestConfig } from '@williamthorsen/nmr/vitest';

export default defineVitestConfig();
```

`vitest` is a peer dependency (`>=4.0.0 <5`), declared optional — the consuming repo provides it, and repos that never import this subpath are unaffected.

### Test categories

The config declares three projects, named for what the tests cover:

| Project       | Matches                                | Covers                                   |
| ------------- | -------------------------------------- | ---------------------------------------- |
| `unit`        | every test file the others don't claim | source code                              |
| `integration` | `*.int.test.{ts,tsx}`                  | behavior beyond source code              |
| `app`         | `*.app.test.{ts,tsx}`                  | the app's own tooling, e.g. drift checks |

All three match only under a `__tests__` directory. Select them at run time with `--project`, which accepts negation:

```bash
vitest --project '!integration'   # everything except integration tests
vitest --project integration      # integration tests alone
vitest                            # every project
```

`unit` is defined by subtracting the other categories rather than by an allow-list of suffixes, so a file such as `parser.smoke.test.ts` runs under `unit` instead of being silently dropped.

### Customizing by scope

Vitest applies some options at the root of a `projects` config and others per project, and placing one at the wrong level is silent rather than loud. The factory therefore takes two separate override surfaces instead of one merged config:

```ts
export default defineVitestConfig({
  // Vite-level options, plus the test options Vitest honours only at the root.
  root: { resolve: { conditions: ['development'] } },
  // Applied to every project.
  project: { setupFiles: ['./vitest.setup.ts'] },
});
```

`root` is typed to accept only the options that work at the root, so writing a per-project option there is a compile error rather than a setting that never runs. Both surfaces merge into the generated config rather than replacing it, so overriding one coverage field leaves the rest intact.

Arrays concatenate rather than replace. `exclude` and `setupFiles` therefore add to what the config already declares, and neither seam can narrow `include` or drop a default exclusion. Adding an `include` pattern through `project` widens all three projects at once, so a file matching it is collected by each and runs three times.

### Root-scoped tests

A monorepo's own root-level tests need a second config, because the package config is found by walking up from a package directory:

```ts
// vitest.root.config.ts
import { defineRootVitestConfig } from '@williamthorsen/nmr/vitest';

export default defineRootVitestConfig();
```

This variant reads `pnpm-workspace.yaml` and excludes every workspace package from all three projects, so a root run covers only root-level files. It reports no coverage of its own — packages cover their own sources.

The monorepo root is located by walking up from the working directory, and every project is pinned to it, so the exclusions hold wherever the run is invoked from. Pass `startDir` to locate it from somewhere else:

```ts
export default defineRootVitestConfig({ startDir: import.meta.dirname });
```

### Migrating from the config-file variants

nmr once selected a package's test scripts by looking for a `vitest.integration.config.ts` on disk, which meant three config files per package that separated its integration tests. Those files are no longer consulted. **Migrate the config and the scripts together**: one without the other leaves the repo in one of the two states below.

1. Replace the repo's root `vitest.config.ts` with `defineVitestConfig()`, and its root-scoped config with `defineRootVitestConfig()`.
2. Delete every `vitest.integration.config.ts` and `vitest.standalone.config.ts`, plus any per-package `vitest.config.ts` that only re-exports an ancestor. Vitest resolves config by walking up from the run root, so those are redundant.
3. Rename integration tests to `*.int.test.ts` and tooling or drift tests to `*.app.test.ts`.
4. Drop any hand-copied `test*` entries from `package.json`, which now shadow the defaults.

Until step 1 is done, an upgraded nmr behaves as follows against a config that declares no projects:

| Command                      | Result                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nmr test` / `test:coverage` | **Succeeds, and runs integration tests too.** The separation is lost with no error, because `--project '!integration'` matches nothing to exclude. |
| `nmr test:integration`       | **Fails** with `No projects matched the filter "integration"`.                                                                                     |

The second is the reliable signal that migration is incomplete. The first is silent, so do not treat a green `nmr test` as evidence that the move succeeded.
