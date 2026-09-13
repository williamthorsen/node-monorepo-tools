<!-- readme-type: cli -->

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
nmr test  # Run tests for the current package
nmr build # Compile to .js and .d.ts
nmr check # Typecheck, format check, lint check, and tests
```

From the monorepo root:

```bash
nmr test    # Run root tests + recursive workspace tests
nmr build   # Build all packages
nmr ci      # Build, then run the strict checks
nmr prepush # Run everything the remote runs, before you push
```

Target packages from anywhere:

```bash
nmr --filter core test # Test only the package whose manifest name is `core`
nmr --recursive lint   # Lint all workspace packages
```

Position determines ownership: flags before the command name are nmr's own, and everything after the command name is forwarded untouched to the resolved command.

`nmr --help` lists every flag and command, with the shell command each command resolves to. Per-package `package.json` files need no script entries.

nmr detects where you are and selects the right scripts automatically — see [context-aware resolution](#context-aware-resolution) below.

## Context-aware resolution

nmr's key feature is that the same command runs different scripts depending on where you invoke it. It walks up from your current directory to find `pnpm-workspace.yaml`, then checks whether your CWD is inside a workspace package directory.

| Where you run `nmr`               | Registry used     | Working directory | `nmr test` runs                                                      |
| --------------------------------- | ----------------- | ----------------- | -------------------------------------------------------------------- |
| Monorepo root                     | Root scripts      | Monorepo root     | `root:test`, then `-R test`                                          |
| Inside a workspace package        | Workspace scripts | The package root  | `pnpm exec vitest --project unit --project tool` (that package only) |
| Anywhere, with `--workspace-root` | Root scripts      | Monorepo root     | `root:test`, then `-R test`                                          |

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

[Scripts and configuration](docs/scripts.md#three-tier-override-system) shows a worked example, how to skip a script for one package, and what nmr does with a `package.json` entry that re-invokes its own command.

## Pre and post hooks

Every `nmr X` invocation auto-wraps as the equivalent of `nmr X:pre && nmr X && nmr X:post`. Hooks are first-class scripts that resolve through the same three tiers as any other script (built-in defaults, then `.config/nmr.config.ts`, then per-package `package.json`). Wrapping is uniform: nested invocations from composite expansion get their own hook treatment. A failing hook ends the sequence, and its exit code propagates.

Extend `nmr build` with a pre-build step for every workspace package:

```ts
// .config/nmr.config.ts
import { defineConfig } from '@williamthorsen/nmr/config';

export default defineConfig({
  workspaceScripts: {
    'build:pre': 'node scripts/generate-manifest.ts',
  },
});
```

[Scripts and configuration](docs/scripts.md#pre-and-post-hooks) covers how hooks behave when absent or skipped, and how to attach a step to one package's hook.

## Configuration

Create `.config/nmr.config.ts` in the monorepo root to add or override scripts. A package may carry one too, for [build settings of its own](docs/scripts.md#package-level-configuration):

```ts
import { defineConfig } from '@williamthorsen/nmr/config';

export default defineConfig({
  workspaceScripts: {
    'copy-content': 'tsx scripts/copy-content.ts',
  },
  rootScripts: {
    'demo:catwalk': 'pnpx http-server --port=5189 demos/catwalk/',
  },
});
```

[Scripts and configuration](docs/scripts.md#configuration) lists every `defineConfig` field and covers package-level configuration and `devBin`.

## What nmr reports

Every command nmr runs reports one line naming the scope it ran at, the command, the outcome, and the timing:

```console
✅ nmr-core: test: passed in 12.4s
❌ nmr: build: failed in 1.2s (exit 1)
⏭️ nmr-core: test: passed 4m ago on this tree, saved ~12s
⛔ nmr-core: lint: skipped, the override is empty
```

**Verdicts print in every verbosity.** `-q` withholds the output of the commands nmr runs, never nmr's own words: a passing quiet run reports its verdicts and nothing else. A command whose override resolved to `""` or `":"` reports the skip rather than exiting 0 in silence, which is what separates it from a command that passed. An `NMR_RUN_IF_PRESENT` miss reports nothing, having no command to report on.

[What nmr reports](docs/reporting.md) covers how verdicts nest, the `--json` format, and where the verbosity of a run comes from.

## Check-result cache

A check that passed on a working tree passes again on the same working tree. nmr records that, and the next run of the same command on an unchanged tree exits 0 without doing the work:

```console
$ nmr ci
# ... four minutes of build, typecheck, lint, and tests ...

$ nmr ci
⏭️ node-monorepo-tools: ci: passed 2m ago on this tree, saved ~4m
```

[Check-result cache](docs/check-cache.md) covers what is cached, what a hit requires, replaying and reading a recorded run, and bypassing or configuring the cache.

## Shared configs and helpers

### Shared Vitest config

Every repo consuming nmr otherwise writes and maintains its own Vitest config. The `@williamthorsen/nmr/vitest` subpath publishes that config as a factory, so a repo declares only what it customizes:

```ts
// vitest.config.ts
import { defineVitestConfig } from '@williamthorsen/nmr/vitest';

export default defineVitestConfig();
```

`@williamthorsen/nmr/tests` exports a check that fails a test run on a test file outside `__tests__` or one that names no tier. [Shared Vitest config](docs/vitest.md) covers the test tiers, that check, what the factory supplies, and customizing it by scope.

### Shared Prettier config

Every repo consuming nmr otherwise maintains its own copy of the house Prettier options, and wires up shell formatting itself. The `@williamthorsen/nmr/prettier` subpath publishes both as a factory, so a repo declares only what it customizes:

```js
// .prettierrc.js
import { definePrettierConfig } from '@williamthorsen/nmr/prettier';

export default definePrettierConfig();
```

[Shared Prettier config](docs/prettier.md) covers what it formats and how to customize it.

### Dependency upgrades

`nmr upgrade` reports available dependency upgrades. A `taze.config.ts` at the monorepo root, built with the `defineConfig` exported by `@williamthorsen/nmr/taze`, declares the upgrade policy. [Dependency upgrades](docs/upgrades.md) covers what each invocation reaches, the policy and its ceilings, and the request timeout.

### Workspace introspection

Repo-wide tests and scripts often need to know where the monorepo root is, or which directories its workspace packages live in. The `@williamthorsen/nmr/workspace` subpath publishes the two pnpm-workspace lookups nmr uses internally:

```ts
// __tests__/packages.test.ts
import { findMonorepoRoot, getWorkspacePackageDirs } from '@williamthorsen/nmr/workspace';

const monorepoRoot = findMonorepoRoot();

for (const packageDir of getWorkspacePackageDirs(monorepoRoot)) {
  // assert something about every workspace package
}
```

[Workspace introspection](docs/workspace.md) covers what each lookup returns and where it diverges from pnpm.

## Agent guidance

nmr ships the rules an agent needs in order to invoke it, as [CodeAssembly](https://github.com/williamthorsen/codeassembly) package content. Adopt it by naming the package in the consuming repo's `.agents/codeassembly.yaml`:

```yaml
packages:
  use:
    - '@williamthorsen/nmr'
```

Then add `codeassembly` as a devDependency and run `codeassembly sync`. The guidance is injected into the machine-local guidance file each harness loads at launch; nothing is copied into the repo or committed there. It resolves from the installed package, so upgrading nmr updates it with no second step.

Wiring the sync to `postinstall` keeps it current without a hand-run command:

```json
{
  "scripts": {
    "postinstall": "codeassembly sync --warn-only"
  }
}
```

`--warn-only` reports a sync failure and exits 0; without it, a failed sync aborts `pnpm install`.

## Conformance checks

nmr publishes a `readyup` kit that checks a consuming repo against the current release: the shared Vitest and Prettier configs, the workspace layout, the root script registry, the [test-tier convention](docs/vitest.md#test-tiers), that every `bin` target is a committed wrapper rather than build output that pnpm cannot link at install time, that `files` covers the output each wrapper loads, that no root install script runs `lefthook install` without `lefthook check-install`, and that no `package.json` in the tree declares a `pnpm` field, which pnpm 11 reads no key from. Those settings belong in `pnpm-workspace.yaml`, and `pnpx codemod run pnpm-v10-to-v11` moves them. The kit ships inside the package, so it checks against the nmr version installed rather than whatever a repository ref happens to point at, and a tier added or renamed in nmr reaches the repo on upgrade. A repo that wants the tier convention in its own gate rather than in a command run by hand declares the [conventions check](docs/vitest.md#gating-the-test-file-conventions) instead, which also covers the half the kit does not.

Add `readyup` as a devDependency, then name nmr in its config:

```ts
// .config/readyup.config.ts
import { defineRdyConfig } from 'readyup';

export default defineRdyConfig({
  packages: ['@williamthorsen/nmr'],
});
```

```bash
rdy run --packages                       # every kit each listed package publishes
rdy run --from npm:@williamthorsen/nmr   # nmr's kit alone, without the config entry
rdy list --from npm:@williamthorsen/nmr  # what nmr publishes
```

`--packages` is the form that survives nmr publishing further kits. Both need `readyup` 0.23 or later, and `@williamthorsen/nmr` as a _direct_ devDependency: a strict pnpm layout links nothing else into the project, so a transitive copy is unreachable.

## Documentation

- [Scripts and configuration](docs/scripts.md): override tiers, script values, hooks, `defineConfig` fields, `devBin`, and the default commands
- [What nmr reports](docs/reporting.md): verdicts, `--json`, and verbosity
- [Check-result cache](docs/check-cache.md): what is skipped, what a hit requires, and replaying, reading, and bypassing recorded runs
- [Dependency upgrades](docs/upgrades.md): `nmr upgrade`, the upgrade policy, `report-catalog`, `report-overrides`, and `nmr-taze`
- [Standalone utilities](docs/utilities.md): `nmr-clean`, `nmr-compile`, `nmr-fmt`, and `ensure-prepublish-hooks`
- [Shared Vitest config](docs/vitest.md): test tiers, test selections, the conventions check, and customization
- [Shared Prettier config](docs/prettier.md): what it formats and how to customize it
- [Workspace introspection](docs/workspace.md): the two workspace lookups
