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

## `release-kit prepare`

Run release preparation with automatic workspace discovery.

Workspace names for `--only` match the package directory name (e.g., `arrays`, `release-kit`).

`prepare` reads each target's history once and builds the changelog items of its unreleased commits. The bump is the highest level that those items call for, under [`versionPatterns`](configuration.md#versionpatterns), so the bump and the changelog describe the same release: A `feat` entry in a [change-record block](changelogs.md#change-record-blocks) bumps minor under a `docs:` title, and a breaking item bumps major.

- A commit that yields no item bumps nothing: one without a ticket-ID prefix, one of a type excluded from the changelog (such as `fmt`), and one whose change-record entries are all undeclared or excluded.
- A `BREAKING CHANGE:` footer raises no major bump. Only a subject's `!` and an entry's `breaking: true` mark an item breaking; on a type whose policy forbids `!`, the footer is reported as a [policy violation](work-types.md#policy-enforcement).
- A target whose commits yield no item is skipped. The prepare report lists the commits that could not be parsed and the change-record diagnostics, skipped targets included.

`--bump` and `--force` are orthogonal in every mode, single-package included: `--bump` is purely a level chooser; `--force` is purely a release trigger. Examples:

```sh
# Release every target at its natural bump level (no flags).
release-kit prepare

# Force a release even when no commit yields a changelog item; defaults to
# patch per target, with each target keeping its natural bump if it has one.
release-kit prepare --force

# Force a release at a uniform level across every releasing target.
release-kit prepare --force --bump=minor

# --bump=X alone is a level chooser, NOT a trigger. If no commit of a target
# yields a changelog item, it skips with a "Pass --force..." reason. Otherwise
# the override applies.
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

The `--set-version` flag is a first-class escape hatch for the cases where the derived bump produces the wrong version — most notably, promoting a pre-1.0 package to 1.0.0. Pre-1.0 packages collapse a `feat!` breaking change to a minor bump (matching semantic-release's `initialMajor: false` and release-please's `bump-minor-pre-major`), so a deliberate promotion to 1.0.0 must be requested explicitly.

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

### Adopting release-kit in a repo with untagged releases

`prepare` finds a target's previous release by its tag. When a target's current version was released and recorded in its `CHANGELOG.md` or `changelog.json` but never tagged, the unreleased window would reach back to the start of history: The new version would absorb every earlier commit, and its bump would be derived from all of them. `prepare` stops before writing anything instead, under `--force` and `--set-version` too, and names each target, its version, and the tag to create:

```text
The current version is recorded in the changelog, but its tag is not the previous tag reachable from HEAD:
  - workspace 'api': 1.2.0 (create tag api-v1.2.0)
Tag the commit that released each version, then run prepare again.
```

Tag each named version at the commit that released it, then run `prepare` again. In a monorepo, `prepare` checks the project only after every workspace passes, so a second run can name the project's tag. The check skips a first release, whose version no changelog records, and a workspace that releases only through propagation.

Each new tag closes a release window. When that window's commits yield items, `prepare` renders the tagged version from them, in place of its hand-written section; it keeps every other hand-written version as [Existing `CHANGELOG.md` sections](changelogs.md#existing-changelogmd-sections) describes.

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
