# @williamthorsen/node-monorepo-core

Context-aware script runner for PNPM monorepos. Ships an `nmr` (node-monorepo run) binary that provides centralized, consistent script execution across workspace packages and the monorepo root.

## Installation

```bash
pnpm add -D @williamthorsen/node-monorepo-core
```

## CLI usage

```
nmr <command>                         # Context-aware: root vs package
nmr -F, --filter <pattern> <command>  # Run in matching packages
nmr -R, --recursive <command>         # Run in all packages
nmr -w, --workspace-root <command>    # Force root script registry
nmr -?, --help                        # Show available commands
nmr --int-test <command>              # Use integration test scripts
```

### Examples

```bash
# From a package directory
nmr test                    # Runs workspace test script
nmr build                   # Runs compile && generate-typings

# From the monorepo root
nmr test                    # Runs root test + recursive workspace tests
nmr ci                      # Runs check:strict && build

# Targeting specific packages
nmr -F core test            # Test only the core package
nmr -R lint                 # Lint all workspace packages

# Force root context from anywhere
nmr -w check                # Run root check from a package dir
```

## Configuration

Create `.config/nmr.config.ts` in the monorepo root to add or override scripts:

```ts
import { defineConfig } from '@williamthorsen/node-monorepo-core';

export default defineConfig({
  workspaceScripts: {
    'copy-content': 'tsx scripts/copy-content.ts',
  },
  rootScripts: {
    'demo:catwalk': 'pnpx http-server --port=5189 demos/catwalk/',
  },
});
```

## Three-tier override system

1. **Package defaults** — built-in scripts shipped with this package
2. **Repo-wide config** — additions/overrides in `.config/nmr.config.ts`
3. **Per-package overrides** — in a package's `package.json` `scripts` field

Per-package overrides take highest precedence. Set a script to `""` in `package.json` to skip it for that package.

Script values can be `string` or `string[]`. Arrays expand to chained `nmr` invocations:

```ts
// "build": ["compile", "generate-typings"]
// expands to: nmr compile && nmr generate-typings
```

## Consistency tests

Export structural consistency checks for use in your test suite:

```ts
// __tests__/consistency.test.ts
import { runConsistencyChecks } from '@williamthorsen/node-monorepo-core/tests';

runConsistencyChecks();
```

This verifies:

- pnpm version matches between `package.json` and GitHub workflow
- Node.js version matches between `.tool-versions` and GitHub workflow

## Consumer migration

After installing, a consuming repo's root `package.json` scripts shrink to lifecycle hooks:

```json
{
  "prepare": "lefthook install",
  "postinstall": "nmr report-overrides"
}
```

Per-package `package.json` files no longer need `ws` script entries. Run `nmr <command>` directly.
