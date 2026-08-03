# Node Monorepo Tools

@nmr/AGENTS.md

## Overview

A pnpm monorepo of CLI tools for Node.js monorepo development. Packages provide a unified script runner (`nmr`) and release automation (`release-kit`), with shared utilities in `core`. Pre-deployment checks use `readyup` (external dev dependency).

## Project structure

Packages live under `packages/`:

- **`@williamthorsen/nmr`**: Context-aware script runner for pnpm monorepos. Detects root vs workspace context and resolves the appropriate script registry.
- **`@williamthorsen/nmr-core`**: Shared utilities consumed by `release-kit`.
- **`@williamthorsen/release-kit`**: Version-bumping and changelog-generation toolkit. Holds the only `*.tool.test.ts` files outside nmr (one drives `git`, one drives Node's type stripper), plus `*.packaged.test.ts` files that need a prior build.
- **`v11y-check`**: Wraps audit-ci with a richer config model, typed JSON source of truth, and a sync workflow that automates allowlist management.

Key files:

- `.config/nmr.config.ts`: Per-repo nmr overrides (a `build:post` hook; dogfoods the config-loading feature)
- `packages/nmr/src/commands/build.ts`: The nmr-managed build (`nmr-compile` bin): a single TypeScript compiler-API emit of `.js` + `.d.ts` with order-invariant content-hash caching, AST-based relative `.ts`→`.js` rewriting, and tsconfig `paths` alias resolution in both outputs
- `vitest.config.ts`: Vitest config for workspace packages; the ancestor each package resolves by walking up
- `vitest.root.config.ts`: Vitest config for root-level tests, excluding every workspace package

## Commands

Use `nmr {command}` for all monorepo scripts. Use `pnpm run {script}` only for scripts defined directly in a package's `package.json`.

**Root-level (from repo root):**

- `pnpm install`: Install all dependencies
- `nmr ci`: What the code-quality workflow runs (build, then strict checks)
- `nmr prepush`: Run the `ci` check plus an audit; a good command to run before pushing to the remote

**From the root or any package directory:**

If run under a package directory, the command applies to that package. Otherwise, it runs recursively in the entire repo:

- `nmr check`: Typecheck, format check, lint check, and tests
- `nmr check:strict`: Strict checks including coverage
- `nmr build`: Build for distribution
- `nmr test`: Run tests

**Recovery, in order (run from the root when build output is missing):**

- `pnpm run bootstrap`: Rebuild nmr-core and nmr from source, restoring the `nmr` command
- `nmr build`: Rebuild the remaining packages, which `nmr check` collects tests against

## Architecture

### nmr script runner

- Default scripts defined in `packages/nmr/src/default-scripts.ts`; per-repo overrides in `.config/nmr.config.ts`
- nmr's default test scripts select Vitest projects, so registry construction touches no files and this repo needs no test-script overrides
- Root scripts delegate to workspaces via `pnpm --recursive exec nmr {command}`

### Build system

- A single TypeScript compiler-API emit via the nmr-managed `nmr-compile` bin (`packages/nmr/src/commands/build.ts`), the default `compile` script
- Emits `.js` and `.d.ts` together; AST-based rewriting turns relative `.ts`→`.js` specifiers and tsconfig `paths` aliases into runnable relative `.js` in both outputs
- `typescript` is a peer dependency (`>=5.7.0`); content-hash caching under `node_modules/.cache/nmr-compile/` skips rebuild when sources haven't changed
- ESM-only output (`type: "module"` in all packages)
- Every package's `prepare` runs the compiler from nmr's source under bare `node`, relying on native type stripping; nmr-core's passes `--conditions nmr-source` so the compiler's own `@williamthorsen/nmr-core` import resolves to source on a tree with no build output

### Testing

- Vitest with v8 coverage provider, configured by two files at the repo root, both thin wrappers over `@williamthorsen/nmr/vitest`
- Both configs declare four projects, an isolation ladder named for the furthest thing a test reaches: `unit` (every test file the others don't claim), `tool` (`*.tool.test.ts`, reaching a program the environment supplies), `localhost`, and `remote`. Select them with `--project`, which unions when repeated and accepts negation
- Every test file names its tier, in the form `<subject>[.<aspect>].<tier>.test.ts`. Only the segment before `.test.` selects a project, so an earlier one (`app`, `packaged`) is free-form documentation. nmr's readyup kit reports an untiered file, which `rdy run --packages` runs here; no test run does, because the residual `unit` claims it and reports success
- A tier names what a test reaches, not how it invokes it: `build.tool.test.ts` drives the TypeScript compiler in-process and is still `tool`. Nor does it describe preconditions: the three `*.packaged.unit.test.ts` files need a prior build but reach only the filesystem while running, so they are `unit`
- `nmr test` runs `--project unit --project tool`, `test:unit` and `test:tool` narrow to one, and `test:all` runs every project. The same six names work from the repo root and from inside a package; `root:test*` variants scope to root-level files alone
- The shared config sets `passWithNoTests`, so a run collecting no files passes, which `test:tool` needs in order to fan out across packages that have none. `__tests__/workspace-test-presence.app.unit.test.ts` keeps that from hiding a package whose suite disappeared
- Typecheck uses `tsgo` (TypeScript native preview)

### Code quality

- Lefthook pre-commit hook auto-formats staged files with Prettier
- `.prettierrc.js` is a thin wrapper over `@williamthorsen/nmr/prettier`, which carries the house options and registers a narrowed `prettier-plugin-sh`, so `nmr fmt` covers shell scripts and Dockerfiles as well
- ESLint with `@williamthorsen/eslint-config-typescript`; optional strict linting via `@williamthorsen/strict-lint`

## Gotchas

- **After `nmr clean`, rebuild before anything else**: run from the repo root, clean removes every package's build output, which the `nmr` binary, `vitest.config.ts`, and `.prettierrc.js` all load, so `nmr`, Vitest, Prettier, and the pre-commit hook all fail. Recover from the root with `pnpm run bootstrap`, then `nmr build`; bootstrap has to come first, because `nmr` itself is broken until it runs. A fresh clone needs none of it: `pnpm install` compiles every package.
- **Stale nmr config fails silently**: editing `packages/nmr/src/vitest.ts` or `src/prettier.ts` and re-running without rebuilding exercises the previous config with no error.
- **Build caching**: The content-hash cache (under `node_modules/.cache/nmr-compile/`) means a rebuild won't run if only non-source files change. Force a rebuild with `nmr clean`, or by deleting the package's `dist`; missing output is treated as a cache miss.
- **The bootstrap's source condition breaks fresh clones only**: nmr-core's `nmr-source` export condition, and the `--conditions nmr-source` its `prepare` passes, are what let the compiler import nmr-core before nmr-core is built. Remove either and every already-built checkout keeps working, because the import falls through to a `dist` that happens to be there; a fresh clone's `pnpm install` fails instead. `packages/nmr/src/__tests__/bootstrap.tool.test.ts` is what catches it.
- **The bootstrap runs under bare `node`, not a transform**: anything the build's import closure reaches must be erasable TypeScript with explicit `.ts` extensions. A package-level `.config/nmr.config.ts` is loaded the same way, so it cannot use tsconfig `paths` aliases or non-erasable syntax such as `enum`.
