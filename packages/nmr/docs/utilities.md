# Standalone utilities

The binaries behind nmr's default `clean`, `compile`, and `fmt` commands, and a check for the `prepublishOnly` hooks of publishable packages.

## `nmr-clean`

Remove a package's build output (`dist`) and its `nmr-compile` cache entry, so that the next build cannot skip on leftover state. Run from a package directory, it cleans that package; run from the monorepo root, it sweeps every workspace package in a single pass, running each package's resolved `clean`, so a package that overrides `clean`, in `.config/nmr.config.ts` or in its own `package.json`, gets its own command rather than the sweep. Removal is idempotent: Cleaning an unbuilt package is a silent no-op. This is the default `clean` script at both levels.

```bash
nmr-clean
```

## `nmr-compile`

Compile a single package's `src` tree to `dist/esm` with the TypeScript compiler API, emitting `.js` from one program and `.d.ts` from a second that reuses it. The package's own `removeComments` governs the `.js` emit; the declarations emit forces it off, so `.d.ts` files keep their doc comments either way. Because the compiler parses each source file, every relative import form (static, re-export, dynamic `import()`, and bare side-effect) is rewritten from `.ts` or `.tsx` to `.js` in both outputs, and `.ts` occurrences inside strings and comments are left intact. tsconfig `paths` aliases are resolved to runnable relative `.js` specifiers in both outputs, sourced from the package's tsconfig. An aliased import whose target resolves outside the package's `src/` and is not resolvable without the alias mapping fails the build with a diagnostic, rather than being emitted verbatim to produce output that fails at runtime. The build is skipped when every input is unchanged and the previous output is still on disk (the key is cached under `node_modules/.cache/nmr-compile/`, outside the published output). Deleting the output by any means (`nmr clean`, `rm -rf dist`, `git clean`) therefore forces a rebuild rather than a skip. This is the default `compile` script; run it from a package directory.

**What it compiles.** Entry points are `src/**/*.{ts,tsx}` less the directories that contain test scaffolding rather than published code: `__fixtures__/`, `__mocks__/`, `__tests__/`, and `test-utils/`. Add to that list per package with [`build.extraIgnorePatterns`](scripts.md#package-level-configuration). Ignoring a directory drops it as an _entry point_, not from the emit: The compiler still emits whatever the surviving entry points import, so a helper that production code uses is still compiled and the compiler never emits a dangling specifier in its importer. This list is deliberately not the Vitest [coverage exclusions](vitest.md#what-the-config-excludes): Helpers live in `test-utils/` precisely so that they stay covered.

**JSX.** A `.tsx` source compiles to `.js` like any other. The package's own tsconfig `jsx` option decides the transform, such as `react-jsx`; the build does not set one.

**The build owns its output directory.** Every rebuild replaces `dist/esm` wholesale, so the directory contains exactly the current emit: A source that was deleted, or that a widened ignore set now covers, leaves nothing behind. Assets therefore belong outside the output directory, or in a `build:post` hook, which composes correctly because it runs after the output is published. Because a bare `nmr compile` does not run any hook, assets that a `build:post` step copies in are absent until a full `nmr build` restores them. An `outdir` that does not resolve inside the package is rejected rather than replaced.

**The replacement is atomic.** The emit is buffered in memory, written to a staging directory beside the output directory, and swapped into place by rename. A build that fails for any reason -- a malformed tsconfig, an unresolvable alias, a full disk -- therefore leaves the previous output exactly as it was. `dist/esm` is never observed mid-write: It contains the previous build or the new one, and is absent only between the two renames. This matters most when the package being rebuilt supplies a binary that other packages in the same recursive build invoke.

**What busts the cache.** The key folds each input's content and path, the emit options, the resolved TypeScript version, and a fingerprint of the nmr running the build -- its own build digest in a workspace checkout, its package version otherwise. Upgrading nmr in a consuming repo therefore rebuilds every package that nmr compiles, and an edit to nmr's own build sources rebuilds each sibling once nmr itself has been rebuilt. A build of nmr's own package folds the version rather than the digest, which is the cache entry that this build is about to write.

`typescript` is an optional peer dependency (`>=5.7.0 <7`), needed only by `nmr-compile`; the consuming repo provides it, and `nmr-compile` run without it fails with an error naming the peer and the version that it requires. The floor is what `rewriteRelativeImportExtensions` requires; the ceiling exists because TypeScript 7 does not include a compiler API: Its root export is a version constant, so `nmr-compile` cannot run on it. Relative imports in source must use explicit `.ts` extensions for them to be rewritten.

```bash
nmr-compile
```

## `nmr-fmt`

Format, or check the formatting of, the files that git reports for the working directory. Exactly one of `--check` and `--write` is required; a bare invocation prints usage and exits non-zero rather than defaulting to a mutation. `--write` also lists the files that it rewrote. This is what `fmt` and `fmt:check` resolve to, in both registries.

`prettier` is a dependency of nmr, but a repo's own copy takes precedence: `nmr-fmt` resolves Prettier from the working directory first and from nmr's installation second. A repository's formatter has to be the one that its editor and pre-commit hook also run, and resolution goes through the module graph rather than `PATH`, so the copy that runs is the one that the repo declares and not whichever `prettier` happens to come first. A repo that does not install Prettier, or nmr, formats with nmr's copy; when it does not have a Prettier config either, the [house config](prettier.md) applies.

A repo's own copy must be Prettier 3.0.0 or later. The design requires `--ignore-path` to honour every flag rather than only the last, so that a repository-root ignore file passed alongside a package-level one is not silently dropped, and 2.x honoured only the final flag.

```bash
nmr-fmt --check
nmr-fmt --write packages/nmr
```

### File selection

`fmt` and `fmt:check` format the files that git reports: tracked files, plus untracked files that git does not ignore. Prettier reads `.gitignore` and `.prettierignore` from the working directory alone, so a pattern in `packages/<pkg>/.gitignore` never applies to a run started at the monorepo root. Because git knows the whole hierarchy, including `.git/info/exclude` and `core.excludesFile`, and every `.prettierignore` in the tree is discovered from the repository root, package-level exclusions apply from any directory as well.

A file that git ignores is never formatted, even when named directly. Because trailing arguments are git pathspecs rather than Prettier flags, `nmr fmt:check packages/nmr` narrows the run, while an unrecognized option and a pathspec that does not match any formattable file both fail it. Running outside a git repository fails rather than reporting a clean run.

`nmr-fmt` drops paths that the index names but the filesystem does not have (a file deleted but not yet staged), submodule gitlinks, and symlinks whatever they point at, before calling Prettier, which rejects a symlink named explicitly. It also skips a path that it is denied access to, such as a `.envrc` that a sandbox shields, and names each one on stderr, so that a check that passes does not hide a file that it never read. Any other failure to stat a listed path fails the run, with an error that names the path.

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
