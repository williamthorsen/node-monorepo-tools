# Changelog

All notable changes to this project will be documented in this file.

## [release-kit-v1.0.1] - 2026-03-12

### Bug fixes

- #34 release-kit|fix: Fix failure to find consumer's config (#35)

Resolves the config file path to an absolute path using `process.cwd()` before passing it to both `existsSync` and `jiti.import()`. Previously, `jiti.import()` received a bare relative path which it resolved against `import.meta.url` (the package's install location), making it impossible for consumers to load their config files. Also fixes root tsconfig includes to cover `.config/` and removes a stale duplicate comment.

## [release-kit-v1.0.0] - 2026-03-12

### Features

- #28 release-kit|feat!: Migrate to CLI-driven release preparation with auto-discovery (#31)

Replaces release-kit's script-based release preparation with a self-contained CLI (`npx @williamthorsen/release-kit prepare`) that auto-discovers workspaces from `pnpm-workspace.yaml`. Adds workspace auto-discovery, TypeScript config loading via jiti, config validation, and a `component()` factory that accepts full workspace-relative paths. Refactors the type system: `WorkTypeConfig` becomes a record keyed by type name, version-bump rules move to a separate `VersionPatterns` structure, and `ComponentConfig` gains a `dir` field for canonical directory identity.

### Refactoring

- #28 release-kit|refactor: Adjust location of config & tags file

### Tooling

- #28 release-kit|tooling: Remove legacy release-kit scripts

## [release-kit-v0.3.0] - 2026-03-11

### Features

- Release-kit|feat: Extract CLI runner into release-kit and co-locate scripts with workflow

Move release script logic (arg parsing, validation, component filtering) into a reusable `runReleasePrepare` function in the release-kit package. Consuming repos now provide only their config and call `runReleasePrepare(config)`.

Relocate release-prepare.ts and release.config.ts from scripts/ to .github/scripts/ so they live alongside the workflow they serve.

- #20 release-kit|feat: Add release-kit init CLI command for automated repo setup (#22)

Add an interactive `npx release-kit init` CLI command that checks repo eligibility, detects monorepo vs single-package layout, scaffolds workflow/scripts/config files, and updates `package.json` with release scripts.

Also expand `runReleasePrepare` to polymorphically handle both `MonorepoReleaseConfig` and `ReleaseConfig`, and update the esbuild plugin to preserve shebangs during compilation.

- #24 release-kit|feat: Return computed tags from release prepare and write .release-tags (#27)

`releasePrepare` and `releasePrepareMono` now return `string[]` of computed tag names instead of `void`. `runReleasePrepare` writes these tags to a `.release-tags` file (one tag per line) so the CI workflow can read them instead of independently deriving tag names from `git diff`. In dry-run mode the file is not written. This makes `tagPrefix` the single source of truth for tag names, eliminating the mismatch between TypeScript-computed tags and workflow-derived tags.

## [strings-v3.1.1] - 2026-03-10

### Tooling

- \*|tooling: Change package registry from github to npmjs

## [tools-v3.0.1] - 2026-03-10

### Tooling

- \*|tooling: Change package registry from github to npmjs

## [release-kit-v0.2.1] - 2026-03-09

### Tooling

- Root|tooling: Make release-kit public

## [release-kit-v0.2.0] - 2026-03-09

### Documentation

- Release-kit|docs: Rewrite README as adoption guide

Replace minimal API docs with end-to-end adoption guide covering single-package and monorepo configurations, release scripts, GitHub Actions workflows that commit directly to `main`.

### Tooling

- #13 root|tooling: Migrate from changesets to release-kit (#16)

Replaces the `@changesets/cli`-based release workflow with the in-house `release-kit` package, adding `git-cliff` for changelog generation, a monorepo release config for all 13 packages, and a CLI wrapper script. Removes all changeset infrastructure and creates per-package baseline version tags.

- #10 root|tooling: Publish release-kit to GitHub Package Registry (#17)

Adds release infrastructure for the toolbelt monorepo: a GitHub Actions `workflow_dispatch` workflow that automates the full release cycle (prepare, commit, tag, push) on `main`, convenience `release:prepare` scripts in the release-kit package, and a `RELEASING.md` documenting the workflow-based release process.

- #10 root|tooling: Streamline release-kit adoption

## [tools-v3.0.0] - 2026-03-08

### Features

- #7 release|feat: Create release-kit package (#9)

Creates the `@williamthorsen/release-kit` package in the `toolbelt` monorepo, extracting version-bumping and changelog-generation logic from `skypilot-site` and `devtools/afg` into a reusable library. The package provides functions for parsing conventional commits, determining semver bump types, updating `package.json` versions across workspaces, and generating changelogs via `git-cliff`.

Add contextual error messages to all I/O operations: file reads/writes in bumpAllVersions, execSync calls in generateChangelogs and releasePrepare, and git commands in getCommitsSinceTarget.

Differentiate expected "no tag" errors from real failures in git describe. Replace string-based commit separator with null-byte to prevent collisions with commit message content. Log git log failures before returning empty results.

Add tests for uppercase/mixed-case type resolution, workspace+breaking combo parsing, breaking-on-first-commit early return, and empty workTypes. Strengthen alias tests to use toStrictEqual for full shape
verification.

Simplify determineBumpType by replacing the redundant isKeyOf guard on RELEASE_PRIORITY with a direct lookup, since bump is already typed as ReleaseType. Simplify parseCommitMessage by replacing mutable object construction with a conditional spread for the optional workspace field.

Add workspaceAliases field to ReleaseConfig and integrate into parseCommitMessage for resolving workspace shorthand names to canonical names. Replace execSync with execFileSync using argument arrays in generateChangelogs and getCommitsSinceTarget to prevent shell injection from paths with special characters. Remove redundant length-check guard in bumpAllVersions, keeping the undefined guard that also narrows the type.

### Refactoring

- Release-kit|refactor: Inline isKeyOf and remove toolbelt.objects dependency

<!-- generated by git-cliff -->
