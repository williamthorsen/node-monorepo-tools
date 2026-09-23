<!-- readme-type: cli -->

# @williamthorsen/release-kit

Version-bumping and changelog-generation toolkit for release workflows.

Provides a self-contained CLI that auto-discovers workspaces from `pnpm-workspace.yaml`, parses conventional commits, determines version bumps, updates `package.json` files, and generates changelogs from the same commit history that decides each bump (with optional [editorial overrides](docs/editorial-overrides.md)).

<!-- section:release-notes --><!-- /section:release-notes -->

## Installation

Requires Node.js 24 or later.

```bash
pnpm add -D @williamthorsen/release-kit
```

## Quick start

```bash
# 1. Scaffold the release workflows
npx @williamthorsen/release-kit init

# 2. Preview what a release would do
npx @williamthorsen/release-kit prepare --dry-run
```

Example output from `prepare --dry-run` in a monorepo whose `arrays` workspace has two commits since its last release:

```
🔍 DRY RUN — no files will be modified

━━━ arrays ━━━
  Found 2 commits since arrays-v1.2.0
  Parsed 2 typed commits
  Bumping versions (minor)...
  📦 1.2.0 → 1.3.0 (minor)
    [dry-run] Would bump packages/arrays/package.json
  Generating changelogs...
    [dry-run] Would generate changelog: packages/arrays/CHANGELOG.md
  🔖 arrays-v1.3.0

✅ Release preparation complete.
   🔖 arrays-v1.3.0
  [dry-run] Would write tmp/.release-tags: arrays-v1.3.0
  [dry-run] Would write tmp/.release-summary
```

Commit the scaffolded workflows, then start a release from the `release` workflow. It runs `prepare` in CI, then commits, tags, and pushes the result:

```sh
gh workflow run release.yaml                  # every workspace with release-worthy changes
gh workflow run release.yaml -f only=arrays   # the named workspaces alone
```

The CLI applies defaults to every discovered workspace. [Releasing](docs/releasing.md) covers `prepare`'s flags, release-notes previews, and the workflow's inputs.

## How it works

1. **Workspace discovery**: reads `pnpm-workspace.yaml` and resolves its `packages` patterns to find workspace directories, applying pnpm's semantics — a `!`-prefixed entry excludes what it matches, wherever it appears in the list. Each directory containing a `package.json` becomes a workspace. The repo is treated as a single-package project when it holds no workspace file, and when the workspace file declares no `packages` list — a file kept for `catalog:` or `overrides:` alone, which pnpm likewise resolves to the root package. A workspace file that declares patterns resolving to no package is an error naming the condition that emptied it.
2. **Config loading**: loads `.config/release-kit.config.ts` (if present), or the file named by `--config`, and merges it with discovered defaults.
3. **Commit analysis**: for each workspace, reads the history once, builds the changelog items of the commits since the last version tag, and takes the bump as the highest level that those items call for.
4. **Version bump + changelog**: bumps `package.json` versions, builds structured `ChangelogEntry[]` from the commits between each pair of release tags, applies any [editorial overrides](docs/editorial-overrides.md) from per-scope `.meta/changelog-overrides.json` files, and renders both `CHANGELOG.md` and `.meta/changelog.json` from that single source, so the two always agree.
5. **Release tags file**: writes computed tags to `tmp/.release-tags` for the release workflow to read when tagging and pushing.

[Changelogs](docs/changelogs.md) covers what reaches a published tarball, the `changelog.json` item schema, and which commits reach a changelog.

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

The `scope|type:` format scopes a commit to a specific workspace in a monorepo. Use `scopeAliases` in your config to map shorthand names to canonical scope names.

[Work types and tiers](docs/work-types.md) lists the recognized types and how each one affects the bump and the changelog.

## Configuration

Configuration is optional. The CLI works out of the box by auto-discovering workspaces and applying defaults. Create `.config/release-kit.config.ts` only when you need to customize behavior.

Every subcommand that reads a config accepts `--config <path>` to read a file elsewhere. An absent default path means "no config"; an absent `--config` path fails the command. See [Config file location](docs/configuration.md#config-file-location).

```typescript
import { defineConfig } from '@williamthorsen/release-kit/config';

export default defineConfig({
  // Exclude a workspace from release processing
  workspaces: [{ dir: 'internal-tools', shouldExclude: true }],

  // Run a formatter after changelog generation (modified file paths are appended as arguments)
  formatCommand: 'npx prettier --write',

  // Override the default version patterns
  versionPatterns: { major: ['!'], minor: ['feat', 'feature'] },

  // Add or override work types (merged with defaults by key)
  workTypes: { perf: { header: 'Performance' } },
});
```

`defineConfig` is a type-safe identity function: it gives the config object validation and completion in `.ts` files and full inference in `.js` ones. The loader also accepts a plain `export default config` or `export const config = { ... }`.

Node loads the file directly, so a relative import inside it needs an explicit file extension — `./work-types.ts`, not `./work-types`.

[Configuration](docs/configuration.md) lists every field and covers legacy identities, retired packages, and tag prefixes. [Project releases](docs/project-releases.md) covers releasing a monorepo as one combined deliverable.

## External dependencies

release-kit shells out to `git`, which must be available on `PATH`, to find tags and read commit history.

## Readiness checks

release-kit publishes two [readyup](https://www.npmjs.com/package/readyup) kits: `default` checks release-kit's own setup, and `npm-auto-publish` checks OIDC-based npm publishing. Add `readyup` as a devDependency, then name release-kit in its config:

```ts
// .config/readyup.config.ts
import { defineRdyConfig } from 'readyup';

export default defineRdyConfig({
  packages: ['@williamthorsen/release-kit'],
});
```

```bash
rdy run --packages
```

`rdy run` needs `readyup` 0.23 or later, and `@williamthorsen/release-kit` as a _direct_ devDependency: a strict pnpm layout links nothing else into the project; therefore, a transitive copy is unreachable.

[Readiness checks](docs/readiness-checks.md) covers running each kit alone and what `npm-auto-publish` needs from the npm session.

## Migration from changesets

1. Add `@williamthorsen/release-kit` as a dev dependency.
2. Remove `@changesets/cli` from dev dependencies. The [default readyup kit](#readiness-checks) reports a repo that still declares it.
3. Delete the `.changeset/` directory.
4. Run `npx @williamthorsen/release-kit init` to scaffold the release workflows.
5. Remove `changeset:*` scripts from `package.json` (no replacement needed — the CLI handles everything).
6. Create an initial version tag for each package (e.g., `git tag v1.0.0` or `git tag arrays-v1.0.0`).

## Documentation

- [Configuration](docs/configuration.md): `ReleaseKitConfig` fields, workspace overrides and legacy identities, retired packages, tag prefixes, and version patterns
- [Project releases](docs/project-releases.md): the `project` block, and how a project release interacts with `prepare`'s flags
- [Releasing](docs/releasing.md): `init`, `prepare`'s flags and release-notes previews, and the release workflow
- [Publishing](docs/publishing.md): `publish`, the publishability filter, and `create-github-release`
- [Changelogs](docs/changelogs.md): the `changelog.json` item schema, which commits reach a changelog, and release-notes injection
- [Editorial overrides](docs/editorial-overrides.md): correcting generated changelog entries, and `overrides validate`
- [Work types and tiers](docs/work-types.md): tiers, the `!` policy, markers, custom work types, and maintenance of the bundled taxonomy
- [Labels](docs/labels.md): `sync-labels`, label configuration, the workflow's triggers, and the `label-map.json` schema
- [Readiness checks](docs/readiness-checks.md): both readyup kits, and how to run each
- [Programmatic API](docs/api.md): `deriveWorkspaceConfig()`, the script-based approach, and `resolveReleaseTags`
