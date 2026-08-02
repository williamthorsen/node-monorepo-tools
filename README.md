# Pnpm Node monorepo

## Packages

| Package                                               | Description                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| [`@williamthorsen/nmr`](packages/nmr)                 | Context-aware script runner for pnpm monorepos              |
| [`@williamthorsen/nmr-core`](packages/nmr-core)       | Shared utilities for monorepo tools                         |
| [`@williamthorsen/release-kit`](packages/release-kit) | Version-bumping and changelog generation                    |
| [`v11y-check`](packages/v11y-check)                   | Wraps audit-ci with a richer config model and sync workflow |

## Getting started

### Prerequisites

- **Node** -- the version is pinned in `.tool-versions`, which [asdf](https://asdf-vm.com/) and [mise](https://mise.jdx.dev/) both read.
- **pnpm** -- the version is pinned by the `packageManager` field in the root `package.json`. [Corepack](https://github.com/nodejs/corepack) reads that field and gives you the matching version, so it is the method least likely to drift from the repo; its README covers installation. Any [other method](https://pnpm.io/installation) works too.

### Set up a checkout

```shell
pnpm install
pnpm run bootstrap
pnpm exec nmr build
```

`nmr` is both a package in this repo and the runner for its scripts, so a fresh checkout has to build it before `nmr`, Vitest, or Prettier will run. `bootstrap` does that, and it is the one script invoked through `pnpm run` rather than `nmr`. The `nmr build` that follows covers the remaining packages, which some tests import.

## Recommended setup

Install [direnv](https://direnv.net/) and run `direnv allow` from the repo root. The repo's `.envrc` adds `node_modules/.bin` to your `PATH`, so workspace bins like `nmr`, `release-kit`, and `v11y` resolve directly from any subdirectory.

Without direnv, prefix workspace bins with `pnpm exec` (e.g., `pnpm exec nmr <command>`).

## Scripts

Install dependencies (this script has the same effect regardless of where it is run in the project):

```shell
pnpm install
```

---

These commands can be run at the project level or at the level of an individual package (i.e., the simulator API or the Svelte app).

To run at the project level, run the command from the project root. To run at a package level, change to the package's directory. Example: `cd packages/svelte`.

Run all code checks:

```shell
pnpm run check
```

Run the typechecker

```shell
pnpm run typecheck
```

Run the linter:

```shell
pnpm run lint
# OR check for lint and fix issues that can be automatically
pnpm run lint:fix
```

Run tests:

```shell
# Test and watch for changes
pnpm test

# Run tests once
pnpm run test:run

# Run coverage checker
pnpm run test:coverage
```

Shortcut to run typechecking, linting, and tests:

```shell
pnpm run check
```

Check for available dependency upgrades:

```shell
# The root package.json and every workspace
nmr upgrade
# The root package.json alone
nmr root:upgrade
# A single workspace
nmr -F @williamthorsen/nmr upgrade
```

These honor the version ceilings declared in `taze.config.ts`, which holds `@types/node` to the Node major the `engines` floor requires and `typescript` below 7. Add `major` to propose major upgrades, still inside those ceilings, and `--write` to apply the proposals:

```shell
nmr upgrade major
nmr upgrade --write
```
