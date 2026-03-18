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

That's it for most repos. The CLI auto-discovers workspaces and applies sensible defaults. The bundled `cliff.toml.template` is used automatically — no need to copy it. Customize only what you need via `.config/release-kit.config.ts`.

## How it works

1. **Workspace discovery**: reads `pnpm-workspace.yaml` and resolves its `packages` globs to find workspace directories. Each directory containing a `package.json` becomes a component. If no workspace file is found, the repo is treated as a single-package project.
2. **Config loading**: loads `.config/release-kit.config.ts` (if present) via [jiti](https://github.com/unjs/jiti) and merges it with discovered defaults.
3. **Commit analysis**: for each component, finds commits since the last version tag, parses them for type and scope, and determines the appropriate version bump.
4. **Version bump + changelog**: bumps `package.json` versions and generates changelogs via `git-cliff`.
5. **Release tags file**: writes computed tags to `tmp/.release-tags` for the release workflow to read when tagging and pushing.

## CLI reference

### `release-kit prepare`

Run release preparation with automatic workspace discovery.

```
Usage: release-kit prepare [options]

Options:
  --dry-run                   Preview changes without writing files
  --bump=major|minor|patch    Override the bump type for all components
  --only=name1,name2          Only process the named components (monorepo only)
  --help, -h                  Show help
```

Component names for `--only` match the package directory name (e.g., `arrays`, `release-kit`).

### `release-kit init`

Initialize release-kit in the current repository. By default, scaffolds only the GitHub Actions workflow file. Use `--with-config` to also scaffold configuration files.

```
Usage: release-kit init [options]

Options:
  --with-config    Also scaffold .config/release-kit.config.ts and .config/git-cliff.toml
  --force          Overwrite existing files instead of skipping them
  --dry-run        Preview changes without writing files
  --help, -h       Show help
```

Scaffolded files:

- `.github/workflows/release.yaml` — workflow that delegates to a reusable release workflow
- `.config/release-kit.config.ts` — starter config with commented-out customization examples (with `--with-config`)
- `.config/git-cliff.toml` — copied from the bundled template (with `--with-config`)

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

| Field              | Type                             | Description                                                                                                                   |
| ------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `cliffConfigPath`  | `string`                         | Explicit path to cliff config. If omitted, resolved automatically: `.config/git-cliff.toml` → `cliff.toml` → bundled template |
| `components`       | `ComponentOverride[]`            | Override or exclude discovered components (matched by `dir`)                                                                  |
| `formatCommand`    | `string`                         | Shell command to run after changelog generation; modified file paths are appended as arguments                                |
| `versionPatterns`  | `VersionPatterns`                | Rules for which commit types trigger major/minor bumps                                                                        |
| `workspaceAliases` | `Record<string, string>`         | Maps shorthand workspace names to canonical names in commits                                                                  |
| `workTypes`        | `Record<string, WorkTypeConfig>` | Work type definitions, merged with defaults by key                                                                            |

All fields are optional.

### `ComponentOverride`

```typescript
interface ComponentOverride {
  dir: string; // Package directory name (e.g., 'arrays')
  tagPrefix?: string; // Custom git tag prefix (defaults to '${dir}-v')
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

Default: `{ major: ['!'], minor: ['feat', 'feature'] }`

### Default work types

| Key        | Header        | Aliases   |
| ---------- | ------------- | --------- |
| `fix`      | Bug fixes     | `bugfix`  |
| `feat`     | Features      | `feature` |
| `internal` | Internal      |           |
| `refactor` | Refactoring   |           |
| `tests`    | Tests         | `test`    |
| `tooling`  | Tooling       |           |
| `ci`       | CI            |           |
| `deps`     | Dependencies  | `dep`     |
| `docs`     | Documentation | `doc`     |
| `fmt`      | Formatting    |           |

Work types from your config are merged with these defaults by key — your entries override or extend, they don't replace the full set.

## Commit format

release-kit parses commits in these formats:

```
type: description              # e.g., feat: add utility
type(scope): description       # e.g., fix(parser): handle edge case
workspace|type: description    # e.g., arrays|feat: add compact function
!type: description             # breaking change (triggers major bump)
```

The `workspace|type:` format scopes a commit to a specific workspace in a monorepo. Use `workspaceAliases` in your config to map shorthand names to canonical workspace names.

## Using `component()` for manual configuration

If you need to build a `MonorepoReleaseConfig` manually (e.g., for the legacy script-based approach), the exported `component()` helper creates a `ComponentConfig` from a workspace-relative path:

```typescript
import { component } from '@williamthorsen/release-kit';

// Accepts the full workspace-relative path
component('packages/arrays');
// => {
//   dir: 'arrays',
//   tagPrefix: 'arrays-v',
//   packageFiles: ['packages/arrays/package.json'],
//   changelogPaths: ['packages/arrays'],
//   paths: ['packages/arrays/**'],
// }

// Custom tag prefix
component('libs/core', 'core-v');
```

The `dir` field is derived from `path.basename()`, so `packages/arrays` and `libs/arrays` both produce `dir: 'arrays'`.

## GitHub Actions workflow

The `init` command scaffolds a workflow that delegates to a reusable release workflow. For repos that need a self-contained workflow:

### Monorepo

```yaml
name: Release

on:
  workflow_dispatch:
    inputs:
      only:
        description: 'Components to release (comma-separated, leave empty for all)'
        required: false
        type: string
      bump:
        description: 'Override bump type (leave empty to auto-detect)'
        required: false
        type: choice
        options:
          - ''
          - patch
          - minor
          - major

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}

      - uses: actions/setup-node@v4
        with:
          node-version: '24'

      - name: Run release preparation
        run: |
          ARGS=""
          if [ -n "${{ inputs.only }}" ]; then
            ARGS="$ARGS --only=${{ inputs.only }}"
          fi
          if [ -n "${{ inputs.bump }}" ]; then
            ARGS="$ARGS --bump=${{ inputs.bump }}"
          fi
          npx @williamthorsen/release-kit prepare $ARGS

      - name: Check for changes
        id: check
        run: |
          if git diff --quiet; then
            echo "changed=false" >> "$GITHUB_OUTPUT"
            echo "No release-worthy changes found."
          else
            echo "changed=true" >> "$GITHUB_OUTPUT"
          fi

      - name: Read release tags
        if: steps.check.outputs.changed == 'true'
        id: tags
        run: |
          TAGS=$(cat tmp/.release-tags | tr '\n' ' ')
          echo "tags=$TAGS" >> "$GITHUB_OUTPUT"
          echo "Releasing: $TAGS"

      - name: Commit, tag, and push
        if: steps.check.outputs.changed == 'true'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add -A
          git commit -m "release: ${{ steps.tags.outputs.tags }}"
          for TAG in ${{ steps.tags.outputs.tags }}; do
            git tag "$TAG"
          done
          git push origin main ${{ steps.tags.outputs.tags }}
```

### Single-package repo

The same workflow without the `only` input. Replace the prepare step with:

```yaml
- name: Run release preparation
  run: |
    ARGS=""
    if [ -n "${{ inputs.bump }}" ]; then
      ARGS="--bump=${{ inputs.bump }}"
    fi
    npx @williamthorsen/release-kit prepare $ARGS
```

And the tag step with:

```yaml
- name: Read release tag
  if: steps.check.outputs.changed == 'true'
  id: tags
  run: |
    TAG=$(cat tmp/.release-tags)
    echo "tag=$TAG" >> "$GITHUB_OUTPUT"
```

## Triggering a release

```sh
# All components
gh workflow run release.yaml

# Specific component(s)
gh workflow run release.yaml -f only=arrays
gh workflow run release.yaml -f only=arrays,strings -f bump=minor
```

Or use the GitHub UI: Actions > Release > Run workflow.

## cliff.toml setup

The package includes a bundled `cliff.toml.template` that is used automatically when no custom config is found. The resolution order is:

1. Explicit `cliffConfigPath` in `.config/release-kit.config.ts`
2. `.config/git-cliff.toml`
3. `cliff.toml` (repo root)
4. Bundled `cliff.toml.template` (automatic fallback)

The bundled template provides a generic git-cliff configuration that:

- Strips issue-ticket prefixes matching `^[A-Z]+-\d+\s+` (e.g., `TOOL-123 `, `AFG-456 `)
- Handles both `type: description` and `workspace|type: description` commit formats
- Groups commits by work type into changelog sections

To customize, scaffold a local copy with `release-kit init --with-config` and edit `.config/git-cliff.toml`.

## External dependencies

This package shells out to two external tools:

- **`git`** — must be available on `PATH`. Used to find tags and retrieve commit history.
- **`git-cliff`** — automatically downloaded and cached via `npx` on first invocation. No need to install it as a dev dependency.

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
