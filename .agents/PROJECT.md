# Node Monorepo Tools

@nmr/AGENTS.md

## Overview

A pnpm monorepo of CLI tools for Node.js monorepo development. Packages provide a unified script runner (`nmr`) and release automation (`release-kit`), with shared utilities in `core`. Pre-deployment checks use `readyup` (external dev dependency).

## Project structure

Packages live under `packages/`:

- **`@williamthorsen/nmr`** — Context-aware script runner for pnpm monorepos. Detects root vs workspace context and resolves the appropriate script registry.
- **`@williamthorsen/nmr-core`** — Shared utilities consumed by `release-kit`.
- **`@williamthorsen/release-kit`** — Version-bumping and changelog-generation toolkit. Has integration tests (`*.int.test.ts`).
- **`v11y-check`** — Wraps audit-ci with a richer config model, typed JSON source of truth, and a sync workflow that automates allowlist management.

Key files:

- `.config/nmr.config.ts`: Per-repo nmr overrides (a `build:post` hook; dogfoods the config-loading feature)
- `packages/nmr/src/commands/build.ts`: The nmr-managed build (`nmr-compile` bin): a single TypeScript compiler-API emit of `.js` + `.d.ts` with order-invariant content-hash caching, AST-based relative `.ts`→`.js` rewriting, and tsconfig `paths` alias resolution in both outputs
- `vitest.config.ts`: Vitest config for workspace packages; the ancestor each package resolves by walking up
- `vitest.root.config.ts`: Vitest config for root-level tests, excluding every workspace package

## Commands

Use `nmr {command}` for all monorepo scripts. Use `pnpm run {script}` only for scripts defined directly in a package's `package.json`.

**Root-level (from repo root):**

- `pnpm install` — Install all dependencies
- `nmr ci` — Full CI pipeline (build, strict checks, audit)
- `nmr check` — Typecheck, format check, lint check, and tests
- `nmr check:strict` — Strict checks including coverage and the agent-file stamp; audit runs separately under `ci`
- `nmr build` — Build all packages
- `nmr test` — Run tests across all packages

**Package-level (from any package directory):**

- `nmr build` — Build current package (single-pass `.js` + `.d.ts` emit)
- `nmr test` — Run tests for current package
- `nmr test:watch` — Tests in watch mode
- `nmr test:coverage` — Tests with coverage

**Bootstrap (when nmr isn't built yet):**

- `pnpm run bootstrap` — Build nmr from the root to resolve the chicken-and-egg dependency

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

### Testing

- Vitest with v8 coverage provider, configured by two files at the repo root, both thin wrappers over `@williamthorsen/nmr/vitest`
- Both configs declare three projects named for what the tests cover: `unit` (every test file the others don't claim), `integration` (`*.int.test.ts`), and `app` (`*.app.test.ts`, e.g. drift checks). Select them with `--project`, which accepts negation
- `nmr test` runs `--project '!integration'`, `nmr test:integration` runs `--project integration`, and `nmr test:all` runs every project. The same five names work from the repo root and from inside a package; `root:test*` variants scope to root-level files alone
- The shared config sets `passWithNoTests`, so a run collecting no files passes, which `test:integration` needs in order to fan out across packages that have none. `__tests__/workspace-test-presence.app.test.ts` keeps that from hiding a package whose suite disappeared
- Typecheck uses `tsgo` (TypeScript native preview)

### Code quality

- Lefthook pre-commit hook auto-formats staged files with Prettier
- ESLint with `@williamthorsen/eslint-config-typescript`; optional strict linting via `@williamthorsen/strict-lint`

## Gotchas

- **Bootstrap ordering**: nmr is both a workspace dependency and the script runner. After a fresh clone, or whenever the build output of nmr or nmr-core is missing (`nmr clean` from the root removes both), run `pnpm run bootstrap` from the root before using `nmr` commands. The `nmr` binary loads nmr-core at startup, so a missing nmr-core build breaks every `nmr` command — bootstrap rebuilds both, in order.
- **Bootstrap now gates Vitest too**: `vitest.config.ts` imports nmr's build output, so a missing `dist` fails every Vitest run as a config-load error, not only every `nmr` command. `nmr check` does not build, so bootstrap (or `nmr build`) has to come first. Editing `packages/nmr/src/vitest.ts` and re-running tests without rebuilding silently exercises the previous config.
- **Build caching**: The content-hash cache (under `node_modules/.cache/nmr-compile/`) means a rebuild won't run if only non-source files change. Force a rebuild with `nmr clean`, or by deleting the package's `dist` — missing output is treated as a cache miss.
