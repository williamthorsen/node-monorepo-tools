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
```

Each package compiles during install, so no separate build step is needed.

If `nmr` stops running -- `nmr clean` removes the build output it needs, and Vitest and Prettier read it too -- run `pnpm run bootstrap` and then `nmr build`, both from the repo root.

## Recommended setup

Install [direnv](https://direnv.net/) and run `direnv allow` from the repo root. The repo's `.envrc` adds `node_modules/.bin` to your `PATH`, so workspace bins like `nmr`, `release-kit`, and `v11y` resolve directly from any subdirectory.

Without direnv, prefix workspace bins with `pnpm exec` (e.g., `pnpm exec nmr <command>`).

## Scripts

`nmr` runs this repo's scripts. Scope follows the working directory: from the root a command covers root files and every package; from inside a package, that package alone. `nmr -F <package> <command>` targets one package from anywhere, and `nmr root:<command>` targets root files alone.

Run bare `nmr` to list every command with the shell command it resolves to.

Everyday commands:

```shell
nmr build            # compile .js and .d.ts
nmr check            # typecheck, format check, lint check, tests
nmr fix              # apply lint and format fixes
nmr test             # the unit and tool tiers
nmr test:coverage    # the same tiers, with coverage
nmr test:watch       # the same tiers, in watch mode
```

Tests are grouped into isolation tiers, each named for the furthest thing a test reaches. `nmr test:unit` and `nmr test:tool` narrow to one tier; `nmr test:all` adds the `localhost` and `remote` tiers.

Before pushing:

```shell
nmr ci               # what the code-quality workflow runs: build, then strict checks
nmr prepush          # the dependency audit, then ci
```

### Dependency upgrades

Check for available upgrades:

```shell
# The root package.json and every workspace
nmr upgrade
# The root package.json alone
nmr root:upgrade
# A single workspace
nmr -F @williamthorsen/nmr upgrade
```

These honor the version ceilings declared in `taze.config.ts`, which holds `@types/node` to the Node major the `engines` floor requires and `typescript` below 7. Add `major` to propose major upgrades for the dependencies carrying no such ceiling, and `--write` to apply the proposals:

```shell
nmr upgrade major
nmr upgrade --write
```
