# Releasing

How to scaffold the release workflows, what `release-kit prepare` does with its flags, and how the release workflow runs a release.

The [README](../README.md#quick-start) shows the first run.

## `release-kit init`

Initialize release-kit in the current repository. By default, scaffolds only the GitHub Actions workflow files. Use `--with-config` to also scaffold configuration files.

Scaffolded files:

- `.github/workflows/create-github-release.yaml` — workflow that creates a GitHub Release on tag push, independent of npm publish
- `.github/workflows/publish.yaml` — workflow that delegates to a reusable publish workflow
- `.github/workflows/release.yaml` — workflow that delegates to a reusable release workflow
- `.config/release-kit.config.ts` — starter config with commented-out customization examples (with `--with-config`)
- `.config/git-cliff.toml` — copied from the bundled template (with `--with-config`)

## `release-kit prepare`

Run release preparation with automatic workspace discovery.

Workspace names for `--only` match the package directory name (e.g., `arrays`, `release-kit`).

`--bump` and `--force` are orthogonal: `--bump` is purely a level chooser; `--force` is purely a release trigger. Examples:

```sh
# Release every target at its natural bump level (no flags).
release-kit prepare

# Force a release even when no bump-worthy commits exist; defaults to patch
# per target, with each target keeping its natural bump if one is derivable.
release-kit prepare --force

# Force a release at a uniform level across every releasing target.
release-kit prepare --force --bump=minor

# --bump=X alone is a level chooser, NOT a trigger. If a target has no
# bump-worthy commits, it skips with a "Pass --force..." reason. If it has
# bump-worthy commits, the override applies.
release-kit prepare --bump=minor
```

### Previewing release notes with `--with-release-notes`

`--with-release-notes` writes two versioned files per workspace after each workspace's `changelog.json` is produced:

- `<workspacePath>/docs/README.v<version>.md` — the workspace `README.md` with release notes injected at the `<!-- section:release-notes -->` marker.
- `<workspacePath>/docs/RELEASE_NOTES.v<version>.md` — the standalone release notes for this version.

The publish-time inject-and-revert lifecycle is unchanged; previews are additive, deterministic, and safe to regenerate. When `changelogJson.enabled` is `false`, prepare reports a warning and skips preview generation. In dry-run mode, planned writes are logged and no files are created.

Because preview filenames are versioned, committing them will accumulate files over time. The recommended `.gitignore` entry for monorepos is:

```gitignore
packages/*/docs/*.v*.md
```

For single-package repos:

```gitignore
docs/*.v*.md
```

### Setting an explicit version with `--set-version`

The `--set-version` flag is a first-class escape hatch for the cases where commit-derived bump logic produces the wrong version — most notably, promoting a pre-1.0 package to 1.0.0. Pre-1.0 packages collapse a `feat!` breaking change to a minor bump (matching semantic-release's `initialMajor: false` and release-please's `bump-minor-pre-major`), so a deliberate promotion to 1.0.0 must be requested explicitly.

The flag validates that:

- The value is canonical `N.N.N` semver (pre-release suffixes are rejected).
- The target is strictly greater than the current version (numeric comparison on each component).
- In monorepo mode, `--only` is set and resolves to exactly one workspace.

`--set-version` is mutually exclusive with `--bump` and `--force`. The rest of the pipeline (changelog generation, tag creation, commit summary, propagation to dependents) runs unchanged, so dependents receive a propagated patch bump triggered by the overridden version.

Promoting a pre-1.0 package to 1.0.0 in a monorepo:

```sh
release-kit prepare --only arrays --set-version 1.0.0
```

An empty changelog section is expected for a bare promotion, because the changelog is generated from commits since the last tag. To include a narrative entry, land a descriptive release commit (e.g., a `feat!` describing the stable API) before running `prepare`.

## GitHub Actions workflow

The `init` command scaffolds a release workflow at `.github/workflows/release.yaml` that delegates to a reusable release workflow. The scaffolded workflow accepts these inputs:

| Input   | Type    | Description                                                                                                                 |
| ------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `only`  | string  | Workspaces to release (comma-separated, leave empty for all)                                                                |
| `bump`  | choice  | Override bump type: `patch`, `minor`, `major` (empty = auto-detect)                                                         |
| `force` | boolean | Release even when no commits or no bump-worthy commits exist (defaults to patch; combine with `bump` for a different level) |

For repos that need a self-contained workflow instead of the reusable one, the scaffolded file can be expanded. The key steps are: checkout with full history (`fetch-depth: 0`), run `release-kit prepare` with optional `--only`, `--bump`, and `--force` flags, check for changes, read tags from `tmp/.release-tags`, then commit, tag, and push.

### Triggering a release

```sh
# All workspaces
gh workflow run release.yaml

# Specific workspace(s)
gh workflow run release.yaml -f only=arrays
gh workflow run release.yaml -f only=arrays,strings -f bump=minor
```

Or use the GitHub UI: Actions > Release > Run workflow.
