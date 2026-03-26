# Node Monorepo Tools monorepo

## Project structure

A PNPM monorepo containing `@williamthorsen/nmr` (the `nmr` script runner), `@williamthorsen/node-monorepo-core` (shared utilities), and `@williamthorsen/release-kit` (version-bumping and changelog toolkit). Packages live under `packages/`.

## Common commands

All script execution goes through `nmr` (`@williamthorsen/nmr`), which provides a unified interface for both root and workspace contexts. Configuration lives in `.config/nmr.config.ts`.

**Root-level development:**

- `pnpm install` - Install all dependencies
- `nmr ci` - Full CI pipeline (strict checks + build)
- `nmr check` - Run typecheck, format check, lint check, and tests
- `nmr check:strict` - Strict checks including coverage and audit
- `nmr build` - Build all packages
- `nmr test` - Run tests across all packages
- `nmr lint` - Lint all packages
- `nmr typecheck` - TypeScript check all packages

**Package-level development (from any package directory):**

- `nmr build` - Build current package
- `nmr test` - Run tests for current package
- `nmr test:watch` - Run tests in watch mode
- `nmr test:coverage` - Run tests with coverage
- `nmr lint` - Lint current package
- `nmr typecheck` - TypeScript check current package

## Architecture

### nmr script runner

- Context-aware: detects whether it is running at the monorepo root or inside a workspace package and resolves the appropriate script registry
- Default scripts are defined in `packages/nmr/src/registries.ts`; per-repo overrides go in `.config/nmr.config.ts`
- Packages with integration tests (detected via `vitest.integration.config.ts`) automatically get split test commands

### Build system

- Uses esbuild via custom `config/build.ts` for TypeScript packages
- Intelligent caching based on content hashes
- Automatic `.ts` to `.js` extension rewriting
- Alias resolution support (`~src/` -> `src/`)

### Testing

- Vitest across all packages with shared configuration
- Base config in `config/vitest.config.ts`
- Coverage reporting with v8 provider
- Package-specific configurations for different test types

### Code quality

- ESLint with `@williamthorsen/eslint-config-typescript`
- Prettier for formatting
- TypeScript strict mode
- Optional strict linting with `@williamthorsen/strict-lint`

## Code style guidelines

- Be type-safe! Never use the `any` type, type assertions, or non-null assertions.

# Important instruction reminders

ALWAYS proceed step by step, asking for confirmation at any significant decision point, unless otherwise instructed.
ALWAYS suggest adding guidance to agent rules, when doing will help avoid making the same mistakes twice. Ask for confirmation before creating or editing rules.
ALWAYS use `nmr {command}` to run monorepo scripts. Use `pnpm run {script}` only for scripts defined directly in a package's `package.json`.
ALWAYS suggest updates to documentation when it would otherwise become out of date.
ALWAYS add newlines to text files (including all source code files, json, and md).
