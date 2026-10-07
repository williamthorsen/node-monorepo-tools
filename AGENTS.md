# Node Monorepo Tools

## Overview

A pnpm monorepo of CLI tools for Node.js monorepo development. Packages provide a unified script runner (`nmr`) and release automation (`release-kit`), with shared utilities in `nmr-core`. Pre-deployment checks use `readyup` (external dev dependency); `nmr`, `release-kit`, and `v11y-check` each publish the kit that checks their own setup, and `.config/readyup.config.ts` names every source whose kits `rdy run --sources` runs, external dependencies included.

## Project structure

Packages live under `packages/`:

- **`@williamthorsen/change-grammar`**: Renders change records as subject lines and parses them back. It does not have any dependencies, and a lint block in `eslint.config.ts` keeps its non-test source from importing anything outside the package.
- **`@williamthorsen/nmr`**: Context-aware script runner for pnpm monorepos. Detects root vs workspace context and resolves the appropriate script registry.
- **`@williamthorsen/nmr-core`**: Shared utilities consumed by `nmr`, `release-kit`, and `v11y-check`.
- **`@williamthorsen/release-kit`**: Version-bumping and changelog-generation toolkit.
- **`v11y-check`**: Wraps audit-ci with a richer config model, typed JSON source of truth, and a sync workflow that automates allowlist management.

## Architecture

### nmr script runner

- Default scripts defined in `packages/nmr/src/default-scripts.ts`; a repo overrides them in `.config/nmr.config.ts`, which here adds only `check:content` and the `check:strict:post` hook that runs it
- `build`, `typecheck`, and every `test` script but `test:watch` fan out to workspaces via an `-R {command}` step; the other root scripts do not, and a `root:`-prefixed one covers root files alone

### Build system

- Two TypeScript compiler-API emits via the nmr-managed `nmr-compile` bin (`packages/nmr/src/commands/build.ts`), the default `compile` script
- Emits `.js` from one program and `.d.ts` from a second that reuses it, which keeps doc comments in the declarations while the package's own `removeComments` still applies to the `.js`; AST-based rewriting turns relative `.ts`→`.js` specifiers and tsconfig `paths` aliases into runnable relative `.js` in both outputs
- ESM-only output (`type: "module"` in all packages)
- The compiler baseline comes from the published `@williamthorsen/tsconfig`, which the root `tsconfig.json` extends and the package configs inherit through it; changing a compiler option means upgrading that package, not editing a config here

### Testing

- `vitest.config.ts` is the ancestor config that each package resolves by walking up; `root:test*` uses `vitest.root.config.ts` alone
- The shared config sets `passWithNoTests`, so a run that doesn't collect any files passes, which `test:tool` needs in order to fan out across packages that have none. `__tests__/workspace-test-presence.app.unit.test.ts` keeps that from hiding a package whose suite disappeared
- Typecheck uses `tsgo` (TypeScript native preview)

### Code quality

- Lefthook pre-commit hook auto-formats staged files with Prettier
- `.prettierrc.js` is a thin wrapper over `@williamthorsen/nmr/prettier`, which sets the house options and registers a narrowed `prettier-plugin-sh`, so `nmr fmt` covers shell scripts and Dockerfiles as well

### Terminal output

- `packages/nmr-core/src/terminal.ts` is the only importer of `@williamthorsen/toolbelt.terminal`, whose `/candidate` API is experimental, and nmr-core is the only package that declares it; `__tests__/toolbelt-terminal-boundary.app.unit.test.ts` fails on any other. Every other package takes style resolution, glyph sets, and wrapping from nmr-core
- A CLI prints an emoji only through a glyph set, `STATUS_GLYPHS` or one built with `defineGlyphSet`, indexed by the style resolved for the stream, so that a pipe or a CI log receives the plain variant

### Agent guidance

- `postinstall` runs `codeassembly sync --warn-only`, which writes the gitignored per-harness local guidance file containing the ambient rulebooks that this repo declares; `--warn-only` keeps a sync failure from breaking the install
- `.agents/codeassembly.yaml` names `@williamthorsen/nmr`, a `workspace:*` devDependency, so this repo consumes the rulebook that it authors at `packages/nmr/agents/guidance/rulebooks/nmr.md`; `.config/nmr.config.ts`'s `check:content` override validates that tree
- Hand-authored guidance in this file does not include a codeassembly rulebook region, because `sync` treats this file as a legacy ambient host and strips any such region that it finds here
- codeassembly's `guidance` checklist covers this file alone; it catches neither a broken `postinstall` nor a `.agents/codeassembly.yaml` that stopped naming the rulebook. `rdy run --sources` is the only command that runs it, and the workflows do not run it

## Gotchas

- **After `nmr clean`, rebuild before anything else**: When run from the repo root, `nmr clean` removes every package's build output, which the `nmr` binary, `vitest.config.ts`, and `.prettierrc.js` all load; without it, `nmr`, Vitest, Prettier, and the pre-commit hook all fail. Recover from the root with `pnpm run bootstrap`, then `nmr build`; bootstrap has to come first, because `nmr` itself is broken until it runs. A fresh clone needs none of it: `pnpm install` compiles every package.
- **Stale nmr config fails silently**: Editing `packages/nmr/src/vitest.ts`, `src/prettier.ts`, or `src/tests.ts` and re-running without rebuilding exercises the previous config without reporting an error. The root conventions guard imports `tests.ts` from `dist`, so until an edit to the check is rebuilt, the guard runs the old check and passes.
- **A reusable-workflow change is inert until its pointer tag moves**: A pull request never exercises an edit to a `*.reusable.yaml`, because every caller in `.github/workflows/` references it through the mutable `workflow/{name}-v1` tag rather than a relative path. The edit does not take effect anywhere -- this repo included -- until the tag is force-moved to the merge commit. The tags drift when that step is skipped; `workflow/release-v1` stayed four months and one pnpm 11 migration behind main. `audit.yaml`'s `workflow_dispatch` trigger exercises a moved tag in about 25 seconds, before a release depends on it.
- **Editing a kit source fails the build until it is recompiled**: `nmr`, `release-kit`, and `v11y-check` each declare `build:pre: rdy verify`, which compares `.readyup/kits/*.js` against the manifest and reports `source stale` when the `.ts` has changed since the last compile. Recompile with `rdy compile` from that package, and commit the bundle and manifest together. The hook runs even when the build itself skips as unchanged, and it runs before `build:post`'s `rdy compile` precisely so that compiling cannot hide the drift.
- **Build caching**: The content-hash cache (under `node_modules/.cache/nmr-compile/`) means a rebuild won't run if only non-source files change. Force a rebuild with `nmr clean`, or by deleting the package's `dist`; missing output is treated as a cache miss. The key also includes a fingerprint of the nmr running the build, so an edit to nmr's own build sources invalidates every other package's cache once nmr itself has been rebuilt. Because the other packages do not depend on `nmr`, its rebuild is not ordered ahead of the packages that it compiles: A package that the pre-rebuild binary compiled keeps the old fingerprint and rebuilds on the following run.
- **The bootstrap's source condition breaks fresh clones only**: nmr-core's `nmr-source` export condition, and the `--conditions nmr-source` passed by every `prepare` that pnpm can run before nmr-core is built (nmr-core's own, and that of any package not depending on it), let the compiler import nmr-core before its build. Remove either and every already-built checkout keeps working, because the import falls through to a `dist` that happens to be there; a fresh clone's `pnpm install` fails instead. `packages/nmr/src/__tests__/bootstrap.tool.test.ts` catches it.
- **The bootstrap runs under bare `node`, not a transform**: Any module in the build's import closure must be erasable TypeScript with explicit `.ts` extensions. A package-level `.config/nmr.config.ts` is loaded the same way, so it cannot use tsconfig `paths` aliases or non-erasable syntax such as `enum`.
