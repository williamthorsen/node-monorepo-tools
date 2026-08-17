# Node Monorepo Tools

## Overview

A pnpm monorepo of CLI tools for Node.js monorepo development. Packages provide a unified script runner (`nmr`) and release automation (`release-kit`), with shared utilities in `nmr-core`. Pre-deployment checks use `readyup` (external dev dependency); `nmr`, `release-kit`, and `v11y-check` each publish the kit that checks their own setup, and `.config/readyup.config.ts` names every package whose kit `rdy run --packages` runs, external dependencies included.

## Project structure

Packages live under `packages/`:

- **`@williamthorsen/nmr`**: Context-aware script runner for pnpm monorepos. Detects root vs workspace context and resolves the appropriate script registry.
- **`@williamthorsen/nmr-core`**: Shared utilities consumed by `nmr`, `release-kit`, and `v11y-check`.
- **`@williamthorsen/release-kit`**: Version-bumping and changelog-generation toolkit.
- **`v11y-check`**: Wraps audit-ci with a richer config model, typed JSON source of truth, and a sync workflow that automates allowlist management.

## Architecture

### nmr script runner

- Default scripts defined in `packages/nmr/src/default-scripts.ts`; a repo overrides them in `.config/nmr.config.ts`, which here adds only `check:content` and the `check:strict:post` hook that runs it
- `build`, `typecheck`, and every `test` script but `test:watch` fan out to workspaces via an `-R {command}` step; every other root script covers the whole tree from the root instead

### Build system

- A single TypeScript compiler-API emit via the nmr-managed `nmr-compile` bin (`packages/nmr/src/commands/build.ts`), the default `compile` script
- Emits `.js` and `.d.ts` together; AST-based rewriting turns relative `.ts`→`.js` specifiers and tsconfig `paths` aliases into runnable relative `.js` in both outputs
- Content-hash caching under `node_modules/.cache/nmr-compile/` skips rebuild when neither the sources nor the toolchain that compiles them have changed
- ESM-only output (`type: "module"` in all packages)
- The compiler baseline comes from the published `@williamthorsen/tsconfig`, which the root `tsconfig.json` extends and the package configs reach through it; changing a compiler option means upgrading that package, not editing a config here

### Testing

- `vitest.config.ts` is the ancestor each package resolves by walking up; `root:test*` reaches `vitest.root.config.ts` alone
- The shared config sets `passWithNoTests`, so a run collecting no files passes, which `test:tool` needs in order to fan out across packages that have none. `__tests__/workspace-test-presence.app.unit.test.ts` keeps that from hiding a package whose suite disappeared
- Typecheck uses `tsgo` (TypeScript native preview)

### Code quality

- Lefthook pre-commit hook auto-formats staged files with Prettier
- `.prettierrc.js` is a thin wrapper over `@williamthorsen/nmr/prettier`, which carries the house options and registers a narrowed `prettier-plugin-sh`, so `nmr fmt` covers shell scripts and Dockerfiles as well

### Agent guidance

- `postinstall` runs `codeassembly sync --warn-only`, which writes the gitignored per-harness local guidance file carrying the ambient rulebooks this repo declares; `--warn-only` keeps a sync failure from breaking the install
- `.agents/codeassembly.yaml` names `@williamthorsen/nmr`, a `workspace:*` devDependency, so this repo consumes the rulebook it authors at `packages/nmr/agents/guidance/rulebooks/nmr.md`; `.config/nmr.config.ts`'s `check:content` override validates that tree
- `sync` treats this file as a legacy ambient host and strips any codeassembly rulebook region it finds here, so hand-authored guidance carries none
- codeassembly's `guidance` checklist covers this file alone, so it catches neither a broken `postinstall` nor a `.agents/codeassembly.yaml` that stopped naming the rulebook; `rdy run --packages` is the only thing that runs it, and no workflow does

## Gotchas

- **After `nmr clean`, rebuild before anything else**: run from the repo root, clean removes every package's build output, which the `nmr` binary, `vitest.config.ts`, and `.prettierrc.js` all load, so `nmr`, Vitest, Prettier, and the pre-commit hook all fail. Recover from the root with `pnpm run bootstrap`, then `nmr build`; bootstrap has to come first, because `nmr` itself is broken until it runs. A fresh clone needs none of it: `pnpm install` compiles every package.
- **Stale nmr config fails silently**: editing `packages/nmr/src/vitest.ts` or `src/prettier.ts` and re-running without rebuilding exercises the previous config with no error.
- **A reusable-workflow change is inert until its pointer tag moves**: every caller in `.github/workflows/` reaches its `*.reusable.yaml` through the mutable `workflow/{name}-v1` tag rather than a relative path, so a pull request never exercises an edit to one, and the edit reaches nothing -- this repo included -- until the tag is force-moved to the merge commit. Skipping that step is how the tags drift; `workflow/release-v1` sat four months and one pnpm 11 migration behind main. `audit.yaml`'s `workflow_dispatch` trigger exercises a moved tag in about 25 seconds, before a release depends on it.
- **Editing a kit source fails the build until it is recompiled**: `nmr`, `release-kit`, and `v11y-check` each carry `build:pre: rdy verify`, which compares `.readyup/kits/*.js` against the manifest and reports `source stale` when the `.ts` moved on. Recompile with `rdy compile` from that package, and commit the bundle and manifest together. The hook runs even when the build itself skips as unchanged, and it runs before `build:post`'s `rdy compile` precisely so compiling cannot launder the drift.
- **Build caching**: The content-hash cache (under `node_modules/.cache/nmr-compile/`) means a rebuild won't run if only non-source files change. Force a rebuild with `nmr clean`, or by deleting the package's `dist`; missing output is treated as a cache miss. The key also folds a fingerprint of the nmr running the build, so an edit to nmr's own build sources busts every other package's cache once nmr itself has been rebuilt. No package depends on `nmr`, so nothing orders its rebuild ahead of the packages it compiles: one the pre-rebuild binary reached keeps the old fingerprint and rebuilds on the run after.
- **The bootstrap's source condition breaks fresh clones only**: nmr-core's `nmr-source` export condition, and the `--conditions nmr-source` its `prepare` passes, are what let the compiler import nmr-core before nmr-core is built. Remove either and every already-built checkout keeps working, because the import falls through to a `dist` that happens to be there; a fresh clone's `pnpm install` fails instead. `packages/nmr/src/__tests__/bootstrap.tool.test.ts` is what catches it.
- **The bootstrap runs under bare `node`, not a transform**: anything the build's import closure reaches must be erasable TypeScript with explicit `.ts` extensions. A package-level `.config/nmr.config.ts` is loaded the same way, so it cannot use tsconfig `paths` aliases or non-erasable syntax such as `enum`.
