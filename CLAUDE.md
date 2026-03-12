# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

🚨**Important:** On startup read and follow the instructions in `.agents/shared/startup.md`.
Be aware that `.agents/shared` is a symlink.

## Project Structure

This is a PNPM monorepo with multiple package templates including React, Next.js, Svelte, Astro, Chrome extension, CDK, and API packages. Each package in `packages/` represents a different technology template with its own build configuration.

## Common Commands

**Root-level development:**

- `pnpm install` - Install all dependencies
- `pnpm run check` - Run typecheck, format check, lint check, and tests
- `pnpm run check:strict` - Strict checks including coverage and audit
- `pnpm run ci` - Full CI pipeline (strict checks + build)
- `pnpm run build` - Build all packages
- `pnpm run test` - Run tests across all packages
- `pnpm run lint` - Lint all packages
- `pnpm run typecheck` - TypeScript check all packages

**Package-level development (from any package directory):**

- `pnpm run ws {command}` - Run workspace script (unified interface)
- `pnpm run ws build` - Build current package
- `pnpm run ws test` - Run tests for current package
- `pnpm run ws test:watch` - Run tests in watch mode
- `pnpm run ws test:coverage` - Run tests with coverage
- `pnpm run ws lint` - Lint current package
- `pnpm run ws typecheck` - TypeScript check current package

**Package-specific commands:**

- React: `pnpm dev` (Vite dev server)
- Next.js: `pnpm dev` (Next.js dev server)
- Svelte: `pnpm dev` (Vite dev server)
- Astro: `pnpm dev` (Astro dev server)

## Architecture

### Workspace Script System

- Centralized script management via `scripts/run-workspace-script.ts`
- Each package uses `pnpm run ws {command}` for consistent tooling
- Common scripts defined in `run-workspace-script.ts` with package-level overrides
- Supports integration tests with `--int-test` flag

### Build System

- Uses esbuild via custom `config/build.ts` for TypeScript packages
- Intelligent caching based on content hashes
- Automatic `.ts` to `.js` extension rewriting
- Alias resolution support (`~src/` → `src/`)

### Testing

- Vitest across all packages with shared configuration
- Base config in `config/vitest.config.ts`
- Coverage reporting with v8 provider
- Package-specific configurations for different test types

### Code Quality

- ESLint with `@williamthorsen/eslint-config-typescript`
- Prettier for formatting
- TypeScript strict mode
- Optional strict linting with `@williamthorsen/strict-lint`

## Package Types

- **API**: Node.js API with TypeScript compilation
- **React**: Vite + React with testing setup
- **Next.js**: Next.js with Tailwind CSS
- **Svelte**: SvelteKit with Vite
- **Astro**: Astro static site generator
- **Chrome**: Browser extension with Vite build
- **CDK**: AWS CDK infrastructure as code
- **\_workspace**: Template for new packages

## Code Style Guidelines

- Be type-safe! Never use the `any` type, type assertions, or non-null assertions.

# important-instruction-reminders

ALWAYS proceed step by step, asking for confirmation at any significant decision point, unless otherwise instructed.
ALWAYS suggest adding guidance to agent rules, when doing will help avoid making the same mistakes twice. Ask for confirmation before creating or editing rules.
ALWAYS prefer to add rules in [.agents/shared](.agents/shared) if they are not specific to the current project.
ALWAYS use `pnpm run {script}` to run package.json scripts and `pnpm exec {binary}` to run binaries. This maintains clear distinction between scripts and binaries.
ALWAYS suggest updates to documentation when it would otherwise become out of date.
ALWAYS add newlines to text files (including all source code files, json, and md).
