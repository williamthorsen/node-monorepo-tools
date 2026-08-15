# Node Monorepo Tools

## Overview

A pnpm monorepo of CLI tools for Node.js monorepo development. Packages provide a unified script runner (`nmr`) and release automation (`release-kit`), with shared utilities in `core`. Pre-deployment checks use `readyup` (external dev dependency); `nmr`, `release-kit`, and `v11y-check` each publish the kit that checks their own setup.

## Project structure

Packages live under `packages/`:

- **`@williamthorsen/nmr`**: Context-aware script runner for pnpm monorepos. Detects root vs workspace context and resolves the appropriate script registry.
- **`@williamthorsen/nmr-core`**: Shared utilities consumed by `nmr`, `release-kit`, and `v11y-check`.
- **`@williamthorsen/release-kit`**: Version-bumping and changelog-generation toolkit. Holds the only `*.tool.test.ts` files outside nmr (one drives `git`, one drives Node's type stripper), plus three of the four `*.packaged.unit.test.ts` files, which need a prior build.
- **`v11y-check`**: Wraps audit-ci with a richer config model, typed JSON source of truth, and a sync workflow that automates allowlist management. Holds the fourth `*.packaged.unit.test.ts` file.

Key files:

- `.config/readyup.config.ts`: Names every package whose kit `rdy run --packages` runs, external dependencies included
- `packages/nmr/src/commands/build.ts`: The nmr-managed build (`nmr-compile` bin): a single TypeScript compiler-API emit of `.js` + `.d.ts` with order-invariant content-hash caching, AST-based relative `.ts`→`.js` rewriting, and tsconfig `paths` alias resolution in both outputs
- `vitest.config.ts`: Vitest config for workspace packages; the ancestor each package resolves by walking up
- `vitest.root.config.ts`: Vitest config for root-level tests, excluding every workspace package

## Commands

Use `nmr {command}` for all monorepo scripts. Use `pnpm run {script}` only for scripts defined directly in a package's `package.json`.

**Root-level (from repo root):**

- `pnpm install`: Install all dependencies
- `nmr ci`: What the code-quality workflow runs (build, then strict checks)
- `nmr prepush`: Run the dependency audit, then the `ci` check; a good command to run before pushing to the remote

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

- Default scripts defined in `packages/nmr/src/default-scripts.ts`; a repo overrides them in `.config/nmr.config.ts`, which here adds only `check:content` and the `check:strict:post` hook that runs it
- nmr's default test scripts select Vitest projects, so registry construction touches no files and this repo needs no test-script overrides
- `build`, `typecheck`, and every `test` script but `test:watch` fan out to workspaces via an `-R {command}` step; no other root script does, so `audit*`, `clean`, `fmt*`, `lint*`, `report-overrides`, and `upgrade` cover the whole tree from the root instead

### Build system

- A single TypeScript compiler-API emit via the nmr-managed `nmr-compile` bin (`packages/nmr/src/commands/build.ts`), the default `compile` script
- Emits `.js` and `.d.ts` together; AST-based rewriting turns relative `.ts`→`.js` specifiers and tsconfig `paths` aliases into runnable relative `.js` in both outputs
- `typescript` is a peer dependency (`>=5.7.0`); content-hash caching under `node_modules/.cache/nmr-compile/` skips rebuild when sources haven't changed
- ESM-only output (`type: "module"` in all packages)
- The compiler baseline comes from the published `@williamthorsen/tsconfig`, which the root `tsconfig.json` extends and the package configs reach through it; changing a compiler option means upgrading that package, not editing a config here
- Every package's `prepare` runs the compiler from nmr's source under bare `node`, relying on native type stripping; nmr-core's passes `--conditions nmr-source` so the compiler's own `@williamthorsen/nmr-core` import resolves to source on a tree with no build output

### Testing

- Vitest with v8 coverage provider, configured by two files at the repo root, both thin wrappers over `@williamthorsen/nmr/vitest`, so both declare the same four projects; `root:test*` reaches `vitest.root.config.ts` alone
- `app` and `packaged` are the aspect segments in use here: `build.tool.test.ts` drives the TypeScript compiler in-process and is still `tool`, and the four `*.packaged.unit.test.ts` files need a prior build but reach only the filesystem while running, so they are `unit`
- `rdy run --packages` runs nmr's readyup kit here, which is the only thing that reports a nonconformant test filename
- The shared config sets `passWithNoTests`, so a run collecting no files passes, which `test:tool` needs in order to fan out across packages that have none. `__tests__/workspace-test-presence.app.unit.test.ts` keeps that from hiding a package whose suite disappeared
- Typecheck uses `tsgo` (TypeScript native preview)

### Code quality

- Lefthook pre-commit hook auto-formats staged files with Prettier
- `.prettierrc.js` is a thin wrapper over `@williamthorsen/nmr/prettier`, which carries the house options and registers a narrowed `prettier-plugin-sh`, so `nmr fmt` covers shell scripts and Dockerfiles as well
- ESLint with `@williamthorsen/eslint-config-typescript`; optional strict linting via `@williamthorsen/strict-lint`

### Agent guidance

- This file is the guidance host: Rovo Dev reads it unaided, and Claude Code reaches it through the `@../AGENTS.md` in `.claude/CLAUDE.md`, resolved against that file's own directory rather than the repo root
- `postinstall` runs `codeassembly sync --warn-only`, which writes the gitignored `CLAUDE.local.md` carrying the ambient rulebooks this repo declares; `--warn-only` keeps a sync failure from breaking the install
- `.agents/codeassembly.yaml` names `@williamthorsen/nmr`, a `workspace:*` devDependency, so this repo consumes the rulebook it authors at `packages/nmr/agents/guidance/rulebooks/nmr.md`; `.config/nmr.config.ts`'s `check:content` override validates that tree
- `sync` treats this file as a legacy ambient host and strips any codeassembly rulebook region it finds here, so hand-authored guidance carries none
- codeassembly's `guidance` checklist checks this file alone -- non-empty, reachable from `.claude/CLAUDE.md`, current, and inside the budget -- so it catches neither a broken `postinstall` nor a `.agents/codeassembly.yaml` that stopped naming the rulebook; `rdy run --packages` is the only thing that runs it, and no workflow does

## Gotchas

- **After `nmr clean`, rebuild before anything else**: run from the repo root, clean removes every package's build output, which the `nmr` binary, `vitest.config.ts`, and `.prettierrc.js` all load, so `nmr`, Vitest, Prettier, and the pre-commit hook all fail. Recover from the root with `pnpm run bootstrap`, then `nmr build`; bootstrap has to come first, because `nmr` itself is broken until it runs. A fresh clone needs none of it: `pnpm install` compiles every package.
- **Stale nmr config fails silently**: editing `packages/nmr/src/vitest.ts` or `src/prettier.ts` and re-running without rebuilding exercises the previous config with no error.
- **A reusable-workflow change is inert until its pointer tag moves**: every caller in `.github/workflows/` reaches its `*.reusable.yaml` through the mutable `workflow/{name}-v1` tag rather than a relative path, so a pull request never exercises an edit to one, and the edit reaches nothing -- this repo included -- until the tag is force-moved to the merge commit. Skipping that step is how the tags drift; `workflow/release-v1` sat four months and one pnpm 11 migration behind main. `audit.yaml`'s `workflow_dispatch` trigger exercises a moved tag in about 25 seconds, before a release depends on it.
- **Editing a kit source fails the build until it is recompiled**: `nmr`, `release-kit`, and `v11y-check` each carry `build:pre: rdy verify`, which compares `.readyup/kits/*.js` against the manifest and reports `source stale` when the `.ts` moved on. Recompile with `rdy compile` from that package, and commit the bundle and manifest together. The hook runs even when the build itself skips as unchanged, and it runs before `build:post`'s `rdy compile` precisely so compiling cannot launder the drift.
- **Build caching**: The content-hash cache (under `node_modules/.cache/nmr-compile/`) means a rebuild won't run if only non-source files change. Force a rebuild with `nmr clean`, or by deleting the package's `dist`; missing output is treated as a cache miss.
- **The bootstrap's source condition breaks fresh clones only**: nmr-core's `nmr-source` export condition, and the `--conditions nmr-source` its `prepare` passes, are what let the compiler import nmr-core before nmr-core is built. Remove either and every already-built checkout keeps working, because the import falls through to a `dist` that happens to be there; a fresh clone's `pnpm install` fails instead. `packages/nmr/src/__tests__/bootstrap.tool.test.ts` is what catches it.
- **The bootstrap runs under bare `node`, not a transform**: anything the build's import closure reaches must be erasable TypeScript with explicit `.ts` extensions. A package-level `.config/nmr.config.ts` is loaded the same way, so it cannot use tsconfig `paths` aliases or non-erasable syntax such as `enum`.
