# Project releases

How to add a project-level release to a monorepo, what the `project` block accepts, how that release interacts with `prepare`'s flags, and how to declare it as a `releases` composite instead.

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
- `--only` narrows the run to the named workspaces and their dependents and skips the project release, which is reported as a warning. The project release rolls up every contributing workspace, and `--only` changes which workspaces those are, so rolling up a narrowed set would release a project version covering work that the run excluded. Run a full `prepare` (without `--only`) to include the project release.
- `--set-version` is rejected with an error when `project` or a `releases` composite is configured. `--set-version` sets individual workspaces' versions, but a project release rolls up every contributing workspace; the two semantics don't compose. To use `--set-version`, run on a config without a `project` block.

A `releases` composite has a name, so `--only` can select it: `--only suite` prepares the composite alone, from its own window, and `--only nmr,suite` prepares `nmr`, its dependents, and the composite. A run narrowed by `--only` that doesn't name the composite skips it with a warning.

How `--bump` and `--force` combine for every target is in [Releasing](releasing.md#release-kit-prepare).

## Moving to `releases`

The [`releases`](configuration.md#releases) block declares the same targets by name, and every setting of the `workspaces` and `project` blocks has a counterpart in it, except `project.paths`. A config uses one surface or the other; tag prefixes are unchanged either way.

| Legacy setting                                    | `releases` entry                                      |
| ------------------------------------------------- | ----------------------------------------------------- |
| `workspaces: [{ dir: 'x', shouldExclude: true }]` | `x: false`                                            |
| `workspaces: [{ dir: 'x', legacyIdentities }]`    | `x: { path: 'packages/x', legacyIdentities }`         |
| `project: {}`                                     | `<name>: { includes: [...every retained workspace] }` |
| `project: { tagPrefix: 'app-v' }`                 | `<name>: { includes: [...], tagPrefix: 'app-v' }`     |
| `project: { paths }`                              | No counterpart; keep the `project` block              |

Unlike a `project` block, a composite releases only its listed members' commits, and it has a name that `--only` can select. A workspace left out of `includes` still releases on its own.

A `project` block whose window covers the whole repo only because every workspace is excluded maps to the [repo-root target](configuration.md#the-repo-root), `<name>: { path: '.' }`, together with a `false` entry for each excluded workspace. The root target reads the whole repo by declaration, so a workspace added later doesn't narrow it.

## Publishing and GitHub Releases

`push`, `publish`, and `create-github-release` resolve the project tag on HEAD through the `tagPrefix` of the `project` block or the `releases` composite, alongside the workspace tags:

- `release-kit push` pushes the project tag with the release commit, including when the project tag is the only release tag on HEAD.
- `release-kit publish` never publishes the project tag, because the project does not have an npm package. When `--tags` names it, `publish` warns `Skipping v0.13.0: a project tag is not an npm package.` and publishes nothing for it.
- `release-kit create-github-release` creates a GitHub Release for the project tag from `./.meta/changelog.json`, whatever the root `package.json#private` says. A private workspace's tag is still skipped, as [Publishing](publishing.md#publishability-filter) describes.

The `create-github-release.yaml` workflow that `release-kit init` scaffolds for a monorepo triggers only on `'*-v[0-9]*.[0-9]*.[0-9]*'`, which requires a literal `-v` and does not match a `v<version>` project tag. Add the project pattern to its tag filter:

```yaml
on:
  push:
    tags:
      - '*-v[0-9]*.[0-9]*.[0-9]*'
      - 'v[0-9]*.[0-9]*.[0-9]*'
```

A GitHub tag filter matches from the start of the tag, so `'v[0-9]*.[0-9]*.[0-9]*'` does not match a workspace tag such as `core-v1.0.0`. A custom `tagPrefix` needs its own pattern, such as `'app-v[0-9]*.[0-9]*.[0-9]*'` for `tagPrefix: 'app-v'`. `publish.yaml` does not need the project pattern, because `publish` skips the project tag.

When every workspace sets `private: true`, `init` does not create `create-github-release.yaml` (see [Releasing](releasing.md)). A project-release repo of that shape adds the workflow itself.
