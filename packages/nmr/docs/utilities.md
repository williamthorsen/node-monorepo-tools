# Standalone utilities

The binaries behind nmr's default `clean`, `compile`, and `fmt` commands, and a check for the `prepublishOnly` hooks of publishable packages.

## `nmr-clean`

Remove a package's build output (`dist`) and its `nmr-compile` cache entry, leaving no state behind for the next build to skip on. Run from a package directory it cleans that package; run from the monorepo root it sweeps every workspace package in a single pass, running each package's resolved `clean` — so a package that overrides `clean`, in `.config/nmr.config.ts` or in its own `package.json`, gets its own command rather than the sweep. Removal is idempotent — cleaning an unbuilt package is a silent no-op. This is the default `clean` script at both levels.

```bash
nmr-clean
```

## `nmr-compile`

Compile a single package's `src` tree to `dist/esm` with the TypeScript compiler API, emitting `.js` from one program and `.d.ts` from a second that reuses it. The package's own `removeComments` governs the `.js` emit; the declarations emit forces it off, so `.d.ts` files carry their doc comments either way. Because the compiler parses each source file, every relative import form — static, re-export, dynamic `import()`, and bare side-effect — is rewritten from `.ts` to `.js` in both outputs, and `.ts` occurrences inside strings and comments are left intact. tsconfig `paths` aliases are resolved to runnable relative `.js` specifiers in both outputs, sourced from the package's tsconfig. An aliased import whose target resolves outside the package's `src/` and is not resolvable without the alias mapping fails the build with a diagnostic, rather than being emitted verbatim to produce output that fails at runtime. The build is skipped when no input has changed and the previous output is still on disk (the key is cached under `node_modules/.cache/nmr-compile/`, outside the published output). Deleting the output by any means — `nmr clean`, `rm -rf dist`, `git clean` — therefore forces a rebuild rather than a skip. This is the default `compile` script — run it from a package directory.

**What it compiles.** Entry points are `src/**/*.ts` less the directories that hold test scaffolding rather than shipped code: `__fixtures__/`, `__mocks__/`, `__tests__/`, and `test-utils/`. Add to that list per package with [`build.extraIgnorePatterns`](scripts.md#package-level-configuration). Ignoring a directory drops it as an _entry point_, not from the emit: the compiler still emits whatever the surviving entry points import, so a helper that production code uses is still compiled and its importer never emits a dangling specifier. This list is deliberately not the Vitest [coverage exclusions](vitest.md#what-the-config-excludes) — helpers live in `test-utils/` precisely so they stay covered.

**The build owns its output directory.** Every rebuild replaces `dist/esm` wholesale, so the directory holds exactly the current emit: a source that was deleted, or that a widened ignore set now covers, leaves nothing behind. Assets therefore belong outside the output directory, or in a `build:post` hook, which runs after the output is published and so composes correctly. Note that a bare `nmr compile` runs no hook, so assets a `build:post` step copies in are absent until a full `nmr build` restores them. An `outdir` that does not resolve inside the package is rejected rather than replaced.

**The replacement is atomic.** The emit is buffered in memory, written to a staging directory beside the output directory, and swapped into place by rename. A build that fails for any reason -- a malformed tsconfig, an unresolvable alias, a full disk -- therefore leaves the previous output exactly as it was. `dist/esm` is never observed mid-write: it holds the previous build or the new one, and is absent only between the two renames. This matters most when the package being rebuilt supplies a binary that other packages in the same recursive build invoke.

**What busts the cache.** The key folds each input's content and path, the emit options, the resolved TypeScript version, and a fingerprint of the nmr running the build -- its own build digest in a workspace checkout, its package version otherwise. Upgrading nmr in a consuming repo therefore rebuilds every package nmr compiles, and an edit to nmr's own build sources rebuilds each sibling once nmr itself has been rebuilt. A build of nmr's own package folds the version rather than the digest, which is the cache entry that build is about to write.

`typescript` is a peer dependency (`>=5.7.0 <7`); the consuming repo provides it. The floor is what `rewriteRelativeImportExtensions` requires; the ceiling is because TypeScript 7 ships no compiler API — its root export is a version constant, so `nmr-compile` cannot run on it. Relative imports in source must carry explicit `.ts` extensions for them to be rewritten.

```bash
nmr-compile
```

## `nmr-fmt`

Format, or check the formatting of, the files git reports for the working directory. Exactly one of `--check` and `--write` is required; a bare invocation prints usage and exits non-zero rather than defaulting to a mutation. `--write` also lists the files it rewrote. This is what `fmt` and `fmt:check` resolve to, in both registries.

`prettier` is an optional peer dependency (`>=3.9.5 <4`); the consuming repo provides it, and it is resolved through the module graph rather than from `PATH`, so the copy that runs is the one the repo declares and not whichever `prettier` happens to come first. A repository's formatter has to be the one its editor and pre-commit hook also run, which is why nmr takes it from the consumer instead of bundling a copy. It is optional because a repo can use nmr purely as a script runner; one that formats without a resolvable Prettier gets a message naming the package and the range.

The floor is a currency policy, not a capability boundary. What the design requires is `--ignore-path` honouring every flag rather than only the last, so a repository-root ignore file passed alongside a package-level one is not silently dropped — Prettier has done that since 3.0.0, while 2.x honoured only the final flag. The floor sits at the current release because every consuming repo tracks it; lowering it to `>=3.0.0` would cost correctness nothing.

```bash
nmr-fmt --check
nmr-fmt --write packages/nmr
```

### File selection

`fmt` and `fmt:check` format the files git reports: tracked files, plus untracked files git does not ignore. Prettier reads `.gitignore` and `.prettierignore` from the working directory alone, so a pattern in `packages/<pkg>/.gitignore` never reaches a run started at the monorepo root. git knows the whole hierarchy, including `.git/info/exclude` and `core.excludesFile`, and every `.prettierignore` in the tree is discovered from the repository root, so package-level exclusions apply from any directory as well.

A file git ignores is never formatted, even when named directly. Trailing arguments are git pathspecs rather than Prettier flags, so `nmr fmt:check packages/nmr` narrows the run, while an unrecognized option and a pathspec matching no formattable file both fail it. Running outside a git repository fails rather than reporting a clean run.

Paths the index names but the filesystem does not have (a file deleted but not yet staged) and submodule gitlinks are both dropped, so neither reaches Prettier.

## `ensure-prepublish-hooks`

Verify that all publishable workspace packages have a `prepublishOnly` script. Exits non-zero if any are missing.

```bash
ensure-prepublish-hooks
```

| Flag                  | Description                   | Default           |
| --------------------- | ----------------------------- | ----------------- |
| `--fix`               | Add missing hooks             | —                 |
| `--dry-run`           | Preview what `--fix` would do | —                 |
| `--command <command>` | Custom hook command           | `"npm run build"` |
