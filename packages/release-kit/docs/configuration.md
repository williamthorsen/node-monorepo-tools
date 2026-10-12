# Configuration

The fields of `.config/release-kit.config.ts`, how the `releases` block names release targets, how a workspace declares its prior identities or a retired package, the rule against colliding tag prefixes, the patterns that decide a bump, and the environment variable that sets the output style.

A minimal config file is in the [README](../README.md#configuration).

## Config file location

release-kit reads `.config/release-kit.config.ts`, resolved against the repo root, which release-kit locates from the directory from which it was invoked. A run reads a different file when the subcommand is given `--config <path>`, which is resolved against the invocation directory rather than the root, so that a relative path means what it means in the caller's shell.

The flag is accepted by every subcommand that reads a config: `prepare`, `push`, `publish`, `create-github-release`, `show-tag-prefixes`, `overrides validate`, `sync-labels init`, and `sync-labels generate`. `commit`, `tag`, and `sync-labels sync` don't read a config, and they reject the flag.

The two paths differ in what an absent file means. An absent default path means that the repo doesn't declare a config, and the run proceeds on discovered defaults. An absent `--config` path fails the command with an error naming the resolved path, because a caller who names a file expects that file to be read. A file that exists and fails validation is an error on both paths alike, and so is one that exists and fails to load.

`--config` names a file to read, never a write target. `release-kit init --with-config` scaffolds to `.config/release-kit.config.ts` and doesn't take `--config`, and `sync-labels init` writes its seeded `repoLabels` block to that same path.

## `ReleaseKitConfig` reference

| Field              | Type                                        | Description                                                                                                                                                                                                                                                                              |
| ------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `releases`         | `Record<string, ReleaseEntry>`              | Names, excludes, or composes release targets; see [`releases`](#releases). Can't be combined with `workspaces` or `project`                                                                                                                                                              |
| `workspaces`       | `WorkspaceOverride[]`                       | Override or exclude discovered workspaces (matched by `dir`)                                                                                                                                                                                                                             |
| `formatCommand`    | `string`                                    | Shell command to run after changelog generation; modified file paths are appended as arguments                                                                                                                                                                                           |
| `versionPatterns`  | `VersionPatterns`                           | Rules for which commit types trigger major/minor bumps                                                                                                                                                                                                                                   |
| `scopeAliases`     | `Record<string, string>`                    | Maps shorthand scope names to canonical names in commit titles and in change-record entry `scopes`, which [route items to workspaces](changelogs.md#routing-to-workspaces). A renamed workspace directory or [release target](#releases) needs an entry from its old name to its new one |
| `workTypes`        | `Record<string, WorkTypeConfig>`            | Work type definitions, merged with defaults by key                                                                                                                                                                                                                                       |
| `breakingPolicies` | `Record<string, 'forbidden' \| 'optional'>` | Per-type `!`-policy lookup. Defaults to `DEFAULT_BREAKING_POLICIES`. Replaces the default entirely when provided. Set to `{}` to disable enforcement                                                                                                                                     |
| `retiredPackages`  | `RetiredPackage[]`                          | Packages that once lived in this repo but have been extracted or removed; suppresses undeclared-tag-prefix warnings                                                                                                                                                                      |
| `project`          | `ProjectConfig`                             | Opt-in project-level release block. Declaring `project: {}` (even empty) enables a project-release stage in `prepare`                                                                                                                                                                    |
| `repoLabels`       | `RepoLabelsConfig`                          | Declares the repository's label registry for `sync-labels`; see [Label configuration](labels.md#label-configuration)                                                                                                                                                                     |
| `changelogJson`    | `ChangelogJsonConfig`                       | Controls `.meta/changelog.json`: `enabled` (default `true`), `outputPath` (default `'.meta/changelog.json'`), and `devOnlySections`; see [Custom work types](work-types.md#custom-work-types)                                                                                            |
| `releaseNotes`     | `ReleaseNotesConfig`                        | `shouldInjectIntoReadme` (default `false`) injects release notes into each package's README while it publishes; see [Release-notes injection](changelogs.md#release-notes-injection)                                                                                                     |

All fields are optional.

## `releases`

`releases` maps each release target's name to its declaration. Every discovered workspace is a target, named by its directory, unless an entry excludes or renames it, so the block lists only what differs from the discovered set, along with any directory that releases without being a workspace.

```typescript
const config: ReleaseKitConfig = {
  releases: {
    core: { path: 'packages/nmr-core', legacyIdentities: [{ name: '@scope/core', tagPrefix: 'core-v' }] },
    docs: { path: 'docs' },
    scratch: false,
    suite: { includes: ['nmr', 'core', 'docs'], tagPrefix: 'v' },
  },
};
```

An entry takes one of three shapes:

- **`false`** excludes the discovered workspace that the entry's name names by its directory. An excluded workspace is treated as a `shouldExclude` one is: `prepare` never releases it, and `push`, `publish`, and `create-github-release` skip its tags with a warning.
- **`{ path, tagPrefix?, legacyIdentities? }`** names the discovered workspace at `path`, a repo-relative directory. A `path` that isn't a discovered workspace declares a [directory target](#directory-targets) instead. `legacyIdentities` has the meaning that it has in [`WorkspaceOverride`](#workspaceoverride). `tagPrefix` applies only to a directory target: A workspace's prefix derives from its package name, and an entry that sets one for a workspace is an error.
- **`{ includes, tagPrefix? }`** declares the composite, a release that rolls up the named package and directory targets. It is versioned by the root `package.json`, writes `./CHANGELOG.md`, and reads the commits of its members' windows. Its tag prefix defaults to `'v'`. A config declares at most one composite, because the root `package.json` holds one version. `includes` names targets by their names in this block, and it names at least one. Like a `project` release, the composite's changelog takes every entry in its window, whatever the entry's scopes.

A target's name is its only identity. `--only` and `--set-version` select it by name, and a change-record entry routes to it when a scope names it. A target's name never reaches its tag prefix: A workspace's prefix stays `{unscoped package name}-v` whatever the entry calls it, and a directory's derives from its path. Renaming a workspace in `releases` therefore changes the scope that routes to it; add a [`scopeAliases`](#releasekitconfig-reference) entry from the old name to the new one, so that entries written before the rename still route to the target.

`releases` can't be combined with `workspaces` or `project`, which declare the same targets, and a single-package repo rejects it. None of its entries accepts `paths`: A package's or a directory's commit window is its path, and a composite's is its members' windows. [Moving to `releases`](project-releases.md#moving-to-releases) maps each `workspaces` and `project` setting onto the block; both blocks keep working unchanged.

### Directory targets

A `{ path }` entry whose path isn't a discovered workspace declares a directory target: a Swift app, a Go binary, a container image, or a docs site that has a version, a changelog, and tags but isn't a JS package.

- **Version file.** The directory's `package.json` when it has one, otherwise `version.json` in the directory. Either is a JSON file with a string `version` field, which `prepare` bumps. A directory without either is a config error that names the file to create, such as `{ "version": "0.0.0" }`.
- **Commit window.** The directory. A commit can appear in several targets' changelogs when their windows overlap.
- **Tag prefix.** The directory's basename followed by `-v`, such as `devopticon-v` for `apps/devopticon`, unless the entry sets `tagPrefix`. A basename that can't form a tag name, such as one containing a space, is an error that asks for `tagPrefix`.
- **Changelog.** `CHANGELOG.md` in the directory. A change-record entry routes to the target when a scope names it, as it does to a workspace.
- **Releases.** `--only` and `--set-version` take the target's name. A directory target never takes part in dependency propagation, and `publish` never publishes its tag. `push` pushes the tag, and `create-github-release` creates a GitHub Release for it from the directory's `.meta/changelog.json`.

A path outside the repo, or one that isn't a directory, is an error.

#### The repo root

`{ path: '.' }` declares the repo root as a directory target, which is how a release states whole-repo coverage. Its window is the whole repo, its version file is the root `package.json`, its tag prefix is `v`, and its `CHANGELOG.md` takes every entry in its window, whatever the entry's scopes. A workspace added later is a target of its own and doesn't narrow the root target's window.

The root target and a composite would both version the root `package.json`, so declaring both is an error.

#### Worked example: an app that is the repo's deliverable

`williamthorsen/devopticon` releases a SwiftPM app in `apps/devopticon`, keeps its version in the root `package.json`, and stamps it into the app bundle at build time. Its only workspace is a scaffold under `packages/`. A `project` block covered the whole repo only while the workspace union was empty, so adding a releasable package would have dropped the app and every root-level commit from the changelog. The root target states the coverage:

```typescript
export default defineConfig({
  releases: {
    devopticon: { path: '.' },
    scaffold: false,
  },
});
```

`prepare` bumps the root `package.json`, writes `./CHANGELOG.md` from every commit since the last `v` tag, and tags `v{version}`. A package added under `packages/` later releases under its own `{name}-v` tags, and the root target still reads the whole repo.

To version the app on its own instead, declare `app: { path: 'apps/devopticon' }` with an `apps/devopticon/version.json`; its window is then the app's directory, and its tags are `devopticon-v{version}`.

## `WorkspaceOverride`

```typescript
interface WorkspaceOverride {
  dir: string; // Package directory name (e.g., 'arrays')
  shouldExclude?: boolean; // If true, exclude from release processing
  legacyIdentities?: LegacyIdentity[]; // Prior `(name, tagPrefix)` identities for this workspace
}

interface LegacyIdentity {
  name: string; // Full scoped npm name at the time (e.g., '@scope/pkg')
  tagPrefix: string; // Tag prefix under which historical tags were published (e.g., 'core-v')
}
```

`prepare` never versions or tags an excluded workspace. A tag of one found on HEAD anyway, made by hand or before the exclusion, is skipped with a warning by `push`, `publish`, and `create-github-release`.

`legacyIdentities` captures prior identities of a workspace as complete `(name, tagPrefix)` snapshots. The union of the current `tagPrefix` and each identity's `tagPrefix` is consulted when release-kit searches for the most recent baseline tag and when generating changelogs. Use it when a workspace's historical tags were published under a different npm name, a different tag prefix, or both, typically across a package rename. Both fields are required per identity: Each entry must be a complete historical snapshot that stays valid regardless of subsequent renames. Run `release-kit show-tag-prefixes` to detect undeclared candidates and produce a paste-ready config snippet. Listing the current identity (full `(name, tagPrefix)` match) is rejected as a no-op duplicate; an identity whose `tagPrefix` matches the current but whose `name` differs is valid and documents a prior rename that reused the same tag shape. If the workspace no longer exists in this repo at all (the package was extracted or removed), use [`retiredPackages`](#retiredpackage) instead.

## `RetiredPackage`

```typescript
interface RetiredPackage {
  name: string; // Final scoped npm name while the package lived in this repo
  tagPrefix: string; // Tag prefix under which the package's historical tags were published
  successor?: string; // Optional successor package name (e.g., 'readyup')
}
```

`retiredPackages` is the repo-level complement to `legacyIdentities`. Use `legacyIdentities` when the workspace still exists in this repo under a new identity; use `retiredPackages` when this repo no longer contains a workspace for this package, because the package was extracted to another repo or removed outright. Retired entries are inert: release-kit never consults them for baseline lookup or changelog attribution. Their declared `tagPrefix` values are recognized as historical, so `show-tag-prefixes` stops flagging them under "Undeclared tag prefixes."

Worked example: `preflight` was extracted from this monorepo and continues as the standalone `readyup` project. Its tags stay in this repo as historical anchors:

```typescript
import { defineConfig } from '@williamthorsen/release-kit/config';

export default defineConfig({
  retiredPackages: [{ name: '@scope/preflight', tagPrefix: 'preflight-v', successor: 'readyup' }],
});
```

Validation rules:

- `name` and `tagPrefix` are required per entry and must be non-empty strings.
- `successor` is optional; if present, it must be a non-empty string.
- Full-tuple `(name, tagPrefix)` duplicates within `retiredPackages` are rejected.
- Two entries sharing the same `tagPrefix` but different `name`s are accepted: Such a pair documents a package renamed within the repo before being retired.

`show-tag-prefixes` currently does not render a dedicated "Retired packages" section (deferred). Declaring a retired entry is verifiable by confirming that its `tagPrefix` stops appearing under "Undeclared tag prefixes" in the `show-tag-prefixes` output.

## Tag prefix collisions

Tag prefixes from distinct owners must not be identical or be a strict prefix of one another. An owner is one of:

- An active workspace, comprising its derived `tagPrefix` plus any declared `legacyIdentities[].tagPrefix`. Identities of the same workspace are one owner, so their prefixes are allowed to overlap (this represents the same package across renames).
- A directory target, comprising its `tagPrefix` plus any declared `legacyIdentities[].tagPrefix`, as one owner.
- A `retiredPackages[]` entry (one owner per entry).
- The `project` block or the `releases` composite, when configured.

Because release-kit matches a tag to a prefix when the tag name is the prefix followed by a complete SemVer version, a strict-prefix overlap between distinct owners can match the wrong owner's tags. For example, a retired prefix of `pkg-` collides with a workspace prefix of `pkg-1.0.0-v`, since `pkg-1.0.0-v1.2.3` is `pkg-` followed by the pre-release version `1.0.0-v1.2.3`. The rule rejects every strict-prefix overlap, including one such as `v` and `vue-helpers-v`, whose shorter prefix can't match any tag of the longer one.

The rule is enforced at config load; the resulting error identifies both colliding declarations.

## `release-kit show-tag-prefixes`

Prints a per-workspace table of derived tag prefixes, tag counts, and declared legacy prefixes, with a row for each directory target. Also reports any release-shaped tag prefix in the repo that is neither a derived prefix nor declared via `legacyIdentities`, along with a copy-pasteable `workspaces: [...]` config snippet. The snippet uses a `TODO-fill-in-legacy-npm-name` placeholder for each identity's `name`; replace it with the package's prior npm name before pasting.

Exits `0` when every workspace derives a prefix and the workspaces' prefixes don't collide; exits `1` on any derivation failure or collision. Undeclared candidates do not affect the exit code; the `legacy tag prefixes are declared` readyup check reports them as a warning.

When a config file exists and either fails to load or fails schema validation, the command reports the failure on stderr and exits `1` without printing a preview, because a config that cannot be read leaves the declared-versus-undeclared verdict wrong in the one dimension on which the command exists to report. That holds on the default path and under `--config`, and in single-package mode as well as monorepo mode. An absent default config is a supported state and still previews against derived defaults.

In single-package mode, prints a single row with `workspacePath = .` and `derivedPrefix = v`; legacy entries and undeclared-candidate scanning are not applicable.

## `VersionPatterns`

Defines which work types trigger major or minor bumps. `prepare` applies it to each changelog item of the unreleased window and takes the highest level. An item of a type not listed bumps patch.

```typescript
interface VersionPatterns {
  major: string[]; // Patterns triggering a major bump ('!' = any breaking change)
  minor: string[]; // Commit types triggering a minor bump
}
```

Default: `{ major: ['!'], minor: ['feat'] }`

## Output style

release-kit prints in one of two styles. `rich` marks each status with an emoji, such as ✅ or 🟠. `plain` replaces each emoji with a word, such as `PASS` or `WARN`, which a reader of a log can search for. The style is decided separately for stdout and stderr, so redirecting one stream to a file leaves the other rich at a terminal.

The `RELEASE_KIT_OUTPUT_STYLE` environment variable sets the style for every command, `init` and `sync-labels init` included:

| Value   | Effect                                                                   |
| ------- | ------------------------------------------------------------------------ |
| `auto`  | Detect the style of each stream. The same as leaving the variable unset. |
| `plain` | Print plain on both streams.                                             |
| `rich`  | Print rich on both streams, even in a pipe or under CI.                  |

Any other value is a usage error: release-kit reports it and exits with code 1.

The variable outranks detection. Under `auto`, release-kit defers to detection, which reads `CI`, then the stream, then `TERM`. A stream is plain when any of these holds, and rich otherwise:

1. `CI` is set to anything other than an empty string or `false`.
2. The stream is not a terminal, as when its output is piped or redirected.
3. `TERM` is `linux`, the Linux virtual console, which doesn't draw emoji.

The style affects only emoji. Changelog section emoji are file content rather than terminal output, and they are unaffected.
