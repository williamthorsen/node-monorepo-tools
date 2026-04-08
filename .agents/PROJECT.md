# Node Monorepo Tools

## Overview

A PNPM monorepo of CLI tools for Node.js monorepo development. Packages provide a unified script runner (`nmr`), pre-deployment checks (`preflight`), and release automation (`release-kit`), with shared utilities in `core`.

## Project structure

Packages live under `packages/`:

- **`@williamthorsen/audit-deps`** — Wraps audit-ci with a richer config model, typed JSON source of truth, and a sync workflow that automates allowlist management.
- **`@williamthorsen/nmr`** — Context-aware script runner for PNPM monorepos. Detects root vs workspace context and resolves the appropriate script registry.
- **`@williamthorsen/node-monorepo-core`** — Shared utilities consumed by `release-kit` and `preflight`.
- **`@williamthorsen/preflight`** — Pre-deployment verification checks for environment and configuration.
- **`@williamthorsen/release-kit`** — Version-bumping and changelog-generation toolkit. Has integration tests (`vitest.integration.config.ts`).

Key files:

- `.config/nmr.config.ts` — Per-repo nmr overrides (currently empty; dogfoods the config-loading feature)
- `config/build.ts` — Shared esbuild build script with content-hash caching, `.ts`→`.js` extension rewriting, and `~src/` alias resolution
- `config/vitest.config.ts` — Shared Vitest base configuration

## Commands

Use `nmr {command}` for all monorepo scripts. Use `pnpm run {script}` only for scripts defined directly in a package's `package.json`.

**Root-level (from repo root):**

- `pnpm install` — Install all dependencies
- `nmr ci` — Full CI pipeline (strict checks + build)
- `nmr check` — Typecheck, format check, lint check, and tests
- `nmr check:strict` — Strict checks including coverage and audit
- `nmr build` — Build all packages
- `nmr test` — Run tests across all packages

**Package-level (from any package directory):**

- `nmr build` — Build current package (compile + generate typings)
- `nmr test` — Run tests for current package
- `nmr test:watch` — Tests in watch mode
- `nmr test:coverage` — Tests with coverage

**Bootstrap (when nmr isn't built yet):**

- `pnpm run bootstrap` — Build nmr from the root to resolve the chicken-and-egg dependency

## Architecture

### nmr script runner

- Default scripts defined in `packages/nmr/src/registries.ts`; per-repo overrides in `.config/nmr.config.ts`
- Packages with `vitest.integration.config.ts` automatically get split test commands (`test`, `test:integration`, `test:watch`)
- Root scripts delegate to workspaces via `pnpm --recursive exec nmr {command}`

### Build system

- esbuild via `config/build.ts`, run as `tsx ../../config/build.ts` from each package
- Content-hash caching in `dist/esm/.cache` — skips rebuild when sources haven't changed
- Each package also generates `.d.ts` typings via `tsc --project tsconfig.generate-typings.json`
- ESM-only output (`type: "module"` in all packages)

### Testing

- Vitest with v8 coverage provider
- `release-kit` has integration tests requiring a separate vitest config
- Typecheck uses `tsgo` (TypeScript native preview)

### Code quality

- Lefthook pre-commit hook auto-formats staged files with Prettier
- ESLint with `@williamthorsen/eslint-config-typescript`; optional strict linting via `@williamthorsen/strict-lint`

## Gotchas

- **Bootstrap ordering**: nmr is both a workspace dependency and the script runner. After a fresh clone or if nmr's build output is missing, run `pnpm run bootstrap` from the root before using `nmr` commands.
- **Build caching**: The content-hash cache (`dist/esm/.cache`) means a rebuild won't run if only non-source files change. Delete the cache file to force a rebuild.
