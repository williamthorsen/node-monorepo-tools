# Project releases

How to add a project-level release to a monorepo, what the `project` block accepts, and how that release interacts with `prepare`'s flags.

Some monorepos release a single combined deliverable, such as a Chrome extension, a CLI binary, or a packaged desktop app, for which the per-workspace tags and changelogs alone do not describe what the user actually receives. Declare the optional `project` block to add a project-level release stage that runs alongside the per-workspace pipeline.

```typescript
import type { ReleaseKitConfig } from '@williamthorsen/release-kit/config';

const config: ReleaseKitConfig = {
  // Empty object is enough to opt in. Every non-excluded workspace contributes.
  project: {},
};

export default config;
```

When configured, each `release-kit prepare` run additionally:

- Computes commits since the last project tag (`<tagPrefix><version>`), filtered to `paths` (by default, the union of every contributing workspace's paths).
- Bumps the root `package.json`'s `version` field using the same bump-derivation rules as workspaces (or the `--bump=...` override).
- Regenerates the root `./CHANGELOG.md` from the structured `ChangelogEntry[]` built from the project's release history (scoped to the project's `tagPrefix` and the same `paths`) and any matching editorial overrides, keeping the [existing sections](changelogs.md#existing-changelogmd-sections) whose versions those entries lack.
- Emits `./.meta/changelog.json` (when `changelogJson.enabled`).
- With `--with-release-notes`, additionally emits `./docs/RELEASE_NOTES.v<version>.md`.
- Appends the project tag to `tmp/.release-tags` so that `release-kit commit` and `release-kit tag` pick it up alongside per-workspace tags.

If the history since the last project tag doesn't contain any commit under `paths`, the project release is silently skipped, as a per-workspace release is.

## `ProjectConfig`

```typescript
interface ProjectConfig {
  paths?: string[]; // Defaults to the union of every contributing workspace's paths
  tagPrefix?: string; // Defaults to 'v'
}
```

| Field       | Default                 | Description                                                          |
| ----------- | ----------------------- | -------------------------------------------------------------------- |
| `paths`     | Contributing-path union | Patterns selecting the commits that the project release considers    |
| `tagPrefix` | `'v'`                   | Prefix for project tags. The full tag is `${tagPrefix}${newVersion}` |

By default the contributing workspaces are implicit: Every non-excluded discovered workspace contributes its `<dir>/**` glob, and the project release considers commits under their union.

Declare `paths` to choose the window explicitly. Each entry is a git pathspec, which both the bump and the changelog read. A declared value **replaces** the workspace union rather than extending it: `paths: ['docs/**']` drops every workspace commit from the project release.

In a repo whose content lives at the root, commits don't match any `<dir>/**` glob, so the project release would skip every run. Such a repo declares the whole tree:

```typescript
const config: ReleaseKitConfig = {
  project: { paths: ['**'] },
};
```

`'**'` is the whole-tree pattern, matching root-level files, dotfiles, and nested paths alike.

A bare directory such as `'aws'` selects its whole subtree, as `'aws/**'` does.

Validation rules:

- The root `package.json` must exist and declare a `version` field. release-kit reports an error at config-load time if either is missing.
- The `project` block is rejected in single-package mode (the package's own release already covers the whole repo, so a project tier would only duplicate it).
- `paths`, when declared, must contain at least one non-empty string. An empty array is rejected, because git would read it as the absence of a filter: the inverse of how the array reads.
- Unknown fields inside `project` are rejected.

CLI flag interactions:

- `--dry-run` previews project artifacts alongside workspace artifacts; it doesn't write any files.
- `--bump=major|minor|patch` propagates to the project release as a level chooser. It does not trigger a release on its own when the window doesn't have any commits or any bump-worthy commits.
- `--force` runs the project release even when the history since the last project tag doesn't have any commits or any bump-worthy commits. Defaults to patch when `--bump` is not given; combine with `--bump=X` to release at a different level.
- `--only` narrows the run to the named workspaces and skips the project release, which is reported as a warning. The project release rolls up every contributing workspace, and `--only` changes which workspaces those are, so rolling up a narrowed set would release a project version covering work that the run excluded. Run a full `prepare` (without `--only`) to include the project release.
- `--set-version` is rejected with an error when `project` is configured. `--set-version` operates on a single workspace, but a project release rolls up every contributing workspace; the two semantics don't compose. To use `--set-version`, run on a config without a `project` block.

How `--bump` and `--force` combine for every target is in [Releasing](releasing.md#release-kit-prepare).
