# @williamthorsen/release-kit

Version-bumping and changelog-generation toolkit for release workflows.

Provides a self-contained CLI that auto-discovers workspaces from `pnpm-workspace.yaml`, parses conventional commits, determines version bumps, updates `package.json` files, and generates changelogs with `git-cliff`.

## Installation

```bash
pnpm add -D @williamthorsen/release-kit
```

## Quick start

```bash
# 1. Set up release-kit in your repo (scaffolds the release workflow)
npx @williamthorsen/release-kit init

# 2. Preview what a release would do
npx @williamthorsen/release-kit prepare --dry-run
```

Example output from `prepare --dry-run` in a monorepo:

```
🔍 DRY RUN — no files will be modified

── arrays ──────────────────────────────────────
  Found 4 commits since arrays-v1.2.0
  Parsed 3 typed commits
  Bumping versions (minor)...
  📦 1.2.0 → 1.3.0 (minor)
  [dry-run] Would bump packages/arrays/package.json
  Generating changelogs...
  [dry-run] Would run: npx --yes git-cliff ... --output packages/arrays/CHANGELOG.md
  🏷️  arrays-v1.3.0

── strings ─────────────────────────────────────
  Found 2 commits since strings-v0.5.1
  Parsed 2 typed commits
  Bumping versions (patch)...
  📦 0.5.1 → 0.5.2 (patch)
  [dry-run] Would bump packages/strings/package.json
  Generating changelogs...
  [dry-run] Would run: npx --yes git-cliff ... --output packages/strings/CHANGELOG.md
  🏷️  strings-v0.5.2

✅ Release preparation complete.
   🏷️  arrays-v1.3.0
   🏷️  strings-v0.5.2
```

That's it for most repos. The CLI auto-discovers workspaces and applies sensible defaults. The bundled `cliff.toml.template` is used automatically — no need to copy it. Customize only what you need via `.config/release-kit.config.ts`.

## How it works

1. **Workspace discovery**: reads `pnpm-workspace.yaml` and resolves its `packages` globs to find workspace directories. Each directory containing a `package.json` becomes a component. If no workspace file is found, the repo is treated as a single-package project.
2. **Config loading**: loads `.config/release-kit.config.ts` (if present) via [jiti](https://github.com/unjs/jiti) and merges it with discovered defaults.
3. **Commit analysis**: for each component, finds commits since the last version tag, parses them for type and scope, and determines the appropriate version bump.
4. **Version bump + changelog**: bumps `package.json` versions and generates changelogs via `git-cliff`.
5. **Release tags file**: writes computed tags to `tmp/.release-tags` for the release workflow to read when tagging and pushing.

## Commit format

release-kit parses commits in these formats:

```
type: description              # e.g., feat: add utility
scope|type: description        # e.g., arrays|feat: add compact function
type(scope): description       # e.g., feat(arrays): add compact function
type!: description             # breaking change (triggers major bump)
scope|type!: description       # scoped breaking change
type(scope)!: description      # conventional scoped breaking change
```

The `scope|type:` format scopes a commit to a specific component in a monorepo. Use `scopeAliases` in your config to map shorthand names to canonical scope names.

## Configuration

Configuration is optional. The CLI works out of the box by auto-discovering workspaces and applying defaults. Create `.config/release-kit.config.ts` only when you need to customize behavior.

### Config file

```typescript
import type { ReleaseKitConfig } from '@williamthorsen/release-kit';

const config: ReleaseKitConfig = {
  // Exclude a component from release processing
  components: [{ dir: 'internal-tools', shouldExclude: true }],

  // Run a formatter after changelog generation (modified file paths are appended as arguments)
  formatCommand: 'npx prettier --write',

  // Override the default version patterns
  versionPatterns: { major: ['!'], minor: ['feat', 'feature'] },

  // Add or override work types (merged with defaults by key)
  workTypes: { perf: { header: 'Performance' } },
};

export default config;
```

The config file supports both `export default config` and `export const config = { ... }`.

### `ReleaseKitConfig` reference

| Field             | Type                             | Description                                                                                                                   |
| ----------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `cliffConfigPath` | `string`                         | Explicit path to cliff config. If omitted, resolved automatically: `.config/git-cliff.toml` → `cliff.toml` → bundled template |
| `components`      | `ComponentOverride[]`            | Override or exclude discovered components (matched by `dir`)                                                                  |
| `formatCommand`   | `string`                         | Shell command to run after changelog generation; modified file paths are appended as arguments                                |
| `versionPatterns` | `VersionPatterns`                | Rules for which commit types trigger major/minor bumps                                                                        |
| `scopeAliases`    | `Record<string, string>`         | Maps shorthand scope names to canonical names in commits                                                                      |
| `workTypes`       | `Record<string, WorkTypeConfig>` | Work type definitions, merged with defaults by key                                                                            |

All fields are optional.

### `ComponentOverride`

```typescript
interface ComponentOverride {
  dir: string; // Package directory name (e.g., 'arrays')
  shouldExclude?: boolean; // If true, exclude from release processing
}
```

### `VersionPatterns`

Defines which commit types trigger major or minor bumps. Any recognized type not listed defaults to a patch bump.

```typescript
interface VersionPatterns {
  major: string[]; // Patterns triggering a major bump ('!' = any breaking change)
  minor: string[]; // Commit types triggering a minor bump
}
```

Default: `{ major: ['!'], minor: ['feat'] }`

### Default work types

| Key         | Header          | Aliases       |
| ----------- | --------------- | ------------- |
| `fix`       | Bug fixes       | `bugfix`      |
| `deprecate` | Deprecated      |               |
| `feat`      | Features        | `feature`     |
| `internal`  | Internal        |               |
| `perf`      | Performance     | `performance` |
| `refactor`  | Refactoring     |               |
| `sec`       | Security        | `security`    |
| `tests`     | Tests           | `test`        |
| `tooling`   | Tooling         |               |
| `ci`        | CI              |               |
| `deps`      | Dependencies    | `dep`         |
| `docs`      | Documentation   | `doc`         |
| `ai`        | Agentic support |               |
| `fmt`       | (skipped)       |               |

Work types from your config are merged with these defaults by key — your entries override or extend, they don't replace the full set.

`fmt:` commits are recognized for version-bump determination (they contribute to a patch bump) but are skipped by the bundled `cliff.toml.template`, so they do not appear in `CHANGELOG.md` or release notes.

Release-notes sections are rendered in the declaration order of the merged work-types record, with any unknown titles trailing the known ones. The default `devOnlySections` (excluded from public release notes but still written to `CHANGELOG.md`) are: `Agentic support`, `CI`, `Dependencies`, `Internal`, `Refactoring`, `Tests`, `Tooling`. Override via `changelogJson.devOnlySections` in your config.

## CLI reference

### Global options

| Flag              | Description         |
| ----------------- | ------------------- |
| `--help`, `-h`    | Show help message   |
| `--version`, `-V` | Show version number |

### `release-kit prepare`

Run release preparation with automatic workspace discovery.

| Flag                         | Description                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `--dry-run`                  | Preview changes without writing files                                                                        |
| `--bump=major\|minor\|patch` | Override the bump type for all components                                                                    |
| `--set-version=X.Y.Z`        | Set an explicit canonical semver version; bypasses commit-derived bumps. Requires `--only` in monorepo mode. |
| `--force`                    | Bypass the "no commits since last tag" check (requires `--bump`)                                             |
| `--only=name1,name2`         | Only process the named components (monorepo only)                                                            |
| `--help`, `-h`               | Show help                                                                                                    |

Component names for `--only` match the package directory name (e.g., `arrays`, `release-kit`).

#### Setting an explicit version with `--set-version`

The `--set-version` flag is a first-class escape hatch for the cases where commit-derived bump logic produces the wrong version — most notably, promoting a pre-1.0 package to 1.0.0. Pre-1.0 packages collapse a `feat!` breaking change to a minor bump (matching semantic-release's `initialMajor: false` and release-please's `bump-minor-pre-major`), so a deliberate promotion to 1.0.0 must be requested explicitly.

The flag validates that:

- The value is canonical `N.N.N` semver (pre-release suffixes are rejected).
- The target is strictly greater than the current version (numeric comparison on each component).
- In monorepo mode, `--only` is set and resolves to exactly one component.

`--set-version` is mutually exclusive with `--bump` and `--force`. The rest of the pipeline (changelog generation, tag creation, commit summary, propagation to dependents) runs unchanged, so dependents receive a propagated patch bump triggered by the overridden version.

Promoting a pre-1.0 package to 1.0.0 in a monorepo:

```sh
release-kit prepare --only arrays --set-version 1.0.0
```

An empty changelog section is expected for a bare promotion, because the changelog is generated from commits since the last tag. To include a narrative entry, land a descriptive release commit (e.g., a `feat!` describing the stable API) before running `prepare`.

### `release-kit create-github-release`

Create GitHub Releases from `changelog.json` for tags on HEAD. Independent of `npm publish`: invoking this command creates Releases regardless of whether the matching package was published.

| Flag                   | Description                                                               |
| ---------------------- | ------------------------------------------------------------------------- |
| `--dry-run`            | Preview without creating releases                                         |
| `--tags=tag1,tag2,...` | Only create releases for the named tags (comma-separated, full tag names) |
| `--help`, `-h`         | Show help                                                                 |

When `--tags` is omitted, every release tag pointing at HEAD is processed. The CLI requires the `gh` CLI on `PATH` and `contents: write` permission. The bundled `create-github-release.reusable.yaml` GitHub Actions workflow runs this command in CI.

### `release-kit init`

Initialize release-kit in the current repository. By default, scaffolds only the GitHub Actions workflow file. Use `--with-config` to also scaffold configuration files.

| Flag            | Description                                                                |
| --------------- | -------------------------------------------------------------------------- |
| `--with-config` | Also scaffold `.config/release-kit.config.ts` and `.config/git-cliff.toml` |
| `--force`       | Overwrite existing files instead of skipping them                          |
| `--dry-run`     | Preview changes without writing files                                      |
| `--help`, `-h`  | Show help                                                                  |

Scaffolded files:

- `.github/workflows/create-github-release.yaml` — workflow that creates a GitHub Release on tag push, independent of npm publish
- `.github/workflows/publish.yaml` — workflow that delegates to a reusable publish workflow
- `.github/workflows/release.yaml` — workflow that delegates to a reusable release workflow
- `.config/release-kit.config.ts` — starter config with commented-out customization examples (with `--with-config`)
- `.config/git-cliff.toml` — copied from the bundled template (with `--with-config`)

### `release-kit sync-labels`

Manage GitHub label definitions via config-driven YAML files.

| Subcommand | Description                                                    | Flags                  |
| ---------- | -------------------------------------------------------------- | ---------------------- |
| `init`     | Scaffold config, caller workflow, and generate labels          | `--dry-run`, `--force` |
| `generate` | Regenerate `.github/labels.yaml` from config                   | —                      |
| `sync`     | Trigger the `sync-labels` GitHub Actions workflow via `gh` CLI | —                      |

`init` scaffolds `.config/sync-labels.config.ts` with auto-detected workspace scope labels and a `.github/workflows/sync-labels.yaml` caller workflow, then generates `.github/labels.yaml`. `generate` reads the config and writes `.github/labels.yaml`. `sync` triggers the workflow remotely — it requires the `gh` CLI and an existing workflow file.

## GitHub Actions workflow

The `init` command scaffolds a release workflow at `.github/workflows/release.yaml` that delegates to a reusable release workflow. The scaffolded workflow accepts these inputs:

| Input  | Type   | Description                                                         |
| ------ | ------ | ------------------------------------------------------------------- |
| `only` | string | Components to release (comma-separated, leave empty for all)        |
| `bump` | choice | Override bump type: `patch`, `minor`, `major` (empty = auto-detect) |

For repos that need a self-contained workflow instead of the reusable one, the scaffolded file can be expanded. The key steps are: checkout with full history (`fetch-depth: 0`), run `release-kit prepare` with optional `--only` and `--bump` flags, check for changes, read tags from `tmp/.release-tags`, then commit, tag, and push.

### Triggering a release

```sh
# All components
gh workflow run release.yaml

# Specific component(s)
gh workflow run release.yaml -f only=arrays
gh workflow run release.yaml -f only=arrays,strings -f bump=minor
```

Or use the GitHub UI: Actions > Release > Run workflow.

## cliff.toml setup

The package includes a bundled `cliff.toml.template` that is used automatically when no custom config is found. The resolution order:

| Priority | Path                          | Notes                                           |
| -------- | ----------------------------- | ----------------------------------------------- |
| 1        | `cliffConfigPath` in config   | Explicit path, returned without existence check |
| 2        | `.config/git-cliff.toml`      | Project-level override                          |
| 3        | `cliff.toml`                  | Repo root fallback                              |
| 4        | Bundled `cliff.toml.template` | Automatic fallback                              |

The bundled template provides a generic git-cliff configuration that:

- Strips issue-ticket prefixes matching `^[A-Z]+-\d+\s+` (e.g., `TOOL-123 `, `AFG-456 `)
- Handles both `type: description` and `workspace|type: description` commit formats
- Groups commits by work type into changelog sections

To customize, scaffold a local copy with `release-kit init --with-config` and edit `.config/git-cliff.toml`.

## External dependencies

This package shells out to two external tools:

- **`git`** — must be available on `PATH`. Used to find tags and retrieve commit history.
- **`git-cliff`** — automatically downloaded and cached via `npx` on first invocation. No need to install it as a dev dependency.

## Using `component()` for manual configuration

If you need to build a `MonorepoReleaseConfig` manually (e.g., for the legacy script-based approach), the exported `component()` helper creates a `ComponentConfig` from a workspace-relative path. It reads the workspace's `package.json` to derive the tag prefix from the package name:

```typescript
import { component } from '@williamthorsen/release-kit';

// packages/arrays/package.json contains `"name": "@scope/arrays"`
component('packages/arrays');
// => {
//   dir: 'arrays',
//   tagPrefix: 'arrays-v',
//   workspacePath: 'packages/arrays',
//   packageFiles: ['packages/arrays/package.json'],
//   changelogPaths: ['packages/arrays'],
//   paths: ['packages/arrays/**'],
// }
```

`dir` is the basename of the workspace path and is the stable internal identifier used by `--only`, `ComponentOverride.dir`, and the dependency graph. `tagPrefix` is derived from the unscoped `package.json` `name` — any leading `@scope/` is stripped — so tags reflect the package identity rather than the directory layout. For example, a workspace at `packages/core` with `"name": "@williamthorsen/node-monorepo-core"` produces `tagPrefix: 'node-monorepo-core-v'`, yielding tags like `node-monorepo-core-v1.3.0`.

The workspace's `package.json` must declare a non-empty `name` field; `component()` throws otherwise. If two workspaces produce the same `tagPrefix` (because their unscoped names collide), `mergeMonorepoConfig()` throws and names the colliding workspaces so you can rename one.

## Legacy script-based approach

The CLI-driven approach is recommended for new setups. The script-based approach (using `runReleasePrepare` with a manually maintained config) is still supported for backward compatibility.

```typescript
// .github/scripts/release.config.ts
import type { MonorepoReleaseConfig } from '@williamthorsen/release-kit';
import { component } from '@williamthorsen/release-kit';

export const config: MonorepoReleaseConfig = {
  components: [component('packages/arrays'), component('packages/strings')],
  formatCommand: 'npx prettier --write',
};
```

```typescript
// .github/scripts/release-prepare.ts
import { runReleasePrepare } from '@williamthorsen/release-kit';
import { config } from './release.config.ts';

runReleasePrepare(config);
```

The key difference: the script-based approach requires manually listing every component, while the CLI auto-discovers them from `pnpm-workspace.yaml`.

## Breaking changes

### `resolveReleaseTags` takes components; `ComponentConfig` requires `workspacePath`

Tag resolution is now driven by component records rather than a caller-supplied directory map, so `resolveReleaseTags` can report both the component `dir` and its `workspacePath` for every resolved tag.

- `resolveReleaseTags` signature changed from `(workspaceMap?: Map<string, string>)` to `(components?: readonly ComponentConfig[])`.
- `ComponentConfig` gained a required `workspacePath: string` field.

Replace direct `Map`-based calls with `component()`, which now populates `workspacePath` for you:

```diff
-import { resolveReleaseTags } from '@williamthorsen/release-kit';
-
-const workspaceMap = new Map([['core', 'packages/core']]);
-resolveReleaseTags(workspaceMap);
+import { component, resolveReleaseTags } from '@williamthorsen/release-kit';
+
+resolveReleaseTags([component('packages/core')]);
```

If you construct `ComponentConfig` objects directly, add `workspacePath` alongside the other required fields.

### `release-kit publish` and `release-kit push` replace `--only` with `--tags`

The `--only=<dir>` flag on `release-kit publish` and `release-kit push` has been removed. Both commands now filter by full tag name via `--tags=<tag1>[,<tag2>...]`, matching `release-kit create-github-release`. Passing `--only=...` after upgrading produces an `Unknown option: --only` error.

Local usage mapping:

```diff
-release-kit publish --only=core
+release-kit publish --tags=core-v1.3.0

-release-kit push --only=core,cli
+release-kit push --tags=core-v1.3.0,cli-v0.5.0
```

Omitting `--tags` preserves the previous behavior of operating on every release tag at HEAD. The reusable workflow `publish.reusable.yaml` also accepts an optional `tags:` input, and the scaffolded `publish.yaml` now passes `tags: ${{ github.ref_name }}` so the publish scope is explicit rather than relying on `actions/checkout@v6`'s fetch default. Existing callers that do not set `tags:` continue to work unchanged.

### GitHub Release creation moved to its own command and workflow

`release-kit publish` no longer creates GitHub Releases as a side effect, and the `releaseNotes.shouldCreateGithubRelease` config field has been removed. Adoption is now signaled by installing the dedicated `create-github-release.reusable.yaml` workflow.

If you previously set the field, remove it from `.config/release-kit.config.ts`. The new caller template (scaffolded by `release-kit init`) looks like this:

```yaml
name: Create GitHub Release
on:
  push:
    tags:
      - '*-v[0-9]*.[0-9]*.[0-9]*'
permissions:
  contents: write
jobs:
  create-github-release:
    uses: williamthorsen/node-monorepo-tools/.github/workflows/create-github-release.reusable.yaml@workflow/create-github-release-v1
    with:
      tag: ${{ github.ref_name }}
```

The CLI command was renamed from `release-kit github-release` to `release-kit create-github-release`, and its filter flag changed from `--only=<package-name>` to `--tags=<full-tag-name>[,...]`.

### v1.1.0: `formatCommand` receives file paths as trailing arguments

Previously, `formatCommand` was executed as-is (e.g., `pnpm run fmt` would run without arguments). Now, the paths of all modified files (package.json files and changelogs) are appended as trailing arguments.

If your format command does not accept file arguments, update it to one that does:

```diff
-formatCommand: 'pnpm run fmt',
+formatCommand: 'npx prettier --write',
```

### v1.1.0: `git-cliff` is no longer a required dev dependency

`git-cliff` is now invoked via `npx --yes git-cliff` instead of requiring it as a dev dependency. You can remove it from your `devDependencies`. The version is not pinned, so `npx` downloads and caches the latest version on first invocation. To pin a specific version, use `npx --yes git-cliff@2.12.0` by wrapping the call in a custom script.

## Migration from changesets

1. Add `@williamthorsen/release-kit` as a dev dependency.
2. Remove `@changesets/cli` from dev dependencies.
3. Delete the `.changeset/` directory.
4. Run `npx @williamthorsen/release-kit init` to scaffold workflow and config files.
5. Remove `changeset:*` scripts from `package.json` (no replacement needed — the CLI handles everything).
6. Create an initial version tag for each package (e.g., `git tag v1.0.0` or `git tag arrays-v1.0.0`).

No cliff config copy is needed — the bundled template is used automatically. To customize, run `release-kit init --with-config`.
