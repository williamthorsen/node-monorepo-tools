# Configuration

The fields of `.config/release-kit.config.ts`, how a workspace declares its prior identities or a retired package, the rule against colliding tag prefixes, and the patterns that decide a bump.

A minimal config file is in the [README](../README.md#configuration).

## `ReleaseKitConfig` reference

| Field              | Type                                                      | Description                                                                                                                                          |
| ------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cliffConfigPath`  | `string`                                                  | Explicit path to cliff config. If omitted, resolved automatically: `.config/git-cliff.toml` → `cliff.toml` → bundled template                        |
| `workspaces`       | `WorkspaceOverride[]`                                     | Override or exclude discovered workspaces (matched by `dir`)                                                                                         |
| `formatCommand`    | `string`                                                  | Shell command to run after changelog generation; modified file paths are appended as arguments                                                       |
| `versionPatterns`  | `VersionPatterns`                                         | Rules for which commit types trigger major/minor bumps                                                                                               |
| `scopeAliases`     | `Record<string, string>`                                  | Maps shorthand scope names to canonical names in commits                                                                                             |
| `workTypes`        | `Record<string, WorkTypeConfig>`                          | Work type definitions, merged with defaults by key                                                                                                   |
| `breakingPolicies` | `Record<string, 'forbidden' \| 'optional' \| 'required'>` | Per-type `!`-policy lookup. Defaults to `DEFAULT_BREAKING_POLICIES`. Replaces the default entirely when provided. Set to `{}` to disable enforcement |
| `retiredPackages`  | `RetiredPackage[]`                                        | Packages that once lived in this repo but have been extracted or removed; suppresses undeclared-tag-prefix warnings                                  |
| `project`          | `ProjectConfig`                                           | Opt-in project-level release block. Declaring `project: {}` (even empty) enables a project-release stage in `prepare`                                |
| `repoLabels`       | `RepoLabelsConfig`                                        | Declares the repository's label registry for `sync-labels`; see [Label configuration](labels.md#label-configuration)                                 |

All fields are optional.

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

`legacyIdentities` captures prior identities of a workspace as complete `(name, tagPrefix)` snapshots. The union of the current `tagPrefix` and each identity's `tagPrefix` is consulted when release-kit searches for the most recent baseline tag and when generating changelogs. Use it when a workspace's historical tags were published under a different npm name, a different tag prefix, or both — typically across a package rename. Both fields are required per identity: each entry must be a complete historical snapshot that stays valid regardless of subsequent renames. Run `release-kit show-tag-prefixes` to detect undeclared candidates and produce a paste-ready config snippet. Listing the current identity (full `(name, tagPrefix)` match) is rejected as a no-op duplicate; an identity whose `tagPrefix` matches the current but whose `name` differs is valid and documents a prior rename that reused the same tag shape. If the workspace no longer exists in this repo at all (the package was extracted or removed), use [`retiredPackages`](#retiredpackage) instead.

## `RetiredPackage`

```typescript
interface RetiredPackage {
  name: string; // Final scoped npm name while the package lived in this repo
  tagPrefix: string; // Tag prefix under which the package's historical tags were published
  successor?: string; // Optional successor package name (e.g., 'readyup')
}
```

`retiredPackages` is the repo-level complement to `legacyIdentities`. Use `legacyIdentities` when the workspace still exists in this repo under a new identity; use `retiredPackages` when no workspace for this package exists in this repo anymore — the package was extracted to another repo or removed outright. Retired entries are inert: release-kit never consults them for baseline lookup or changelog attribution. Their declared `tagPrefix` values are recognized as historical, so `show-tag-prefixes` stops flagging them under "Undeclared tag prefixes."

Worked example — `preflight` was extracted from this monorepo and continues as the standalone `readyup` project. Its tags stay in this repo as historical anchors:

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
- Two entries sharing the same `tagPrefix` but different `name`s are accepted — this documents a package renamed within the repo before being retired.

`show-tag-prefixes` currently does not render a dedicated "Retired packages" section (deferred). Declaring a retired entry is verifiable by confirming that its `tagPrefix` stops appearing under "Undeclared tag prefixes" in the `show-tag-prefixes` output.

## Tag prefix collisions

Tag prefixes from distinct owners must not be identical or be a strict prefix of one another. An owner is one of:

- An active workspace, comprising its derived `tagPrefix` plus any declared `legacyIdentities[].tagPrefix`. Identities of the same workspace are one owner, so their prefixes are allowed to overlap (this represents the same package across renames).
- A `retiredPackages[]` entry (one owner per entry).
- The `project` block, when configured.

release-kit resolves baseline tags via `git describe --match=<prefix>*`, so a strict-prefix overlap between distinct owners would cause that glob to return cross-matches against the wrong owner's history. For example, a project prefix of `v` collides with a workspace prefix of `vue-helpers-v`, since `git describe --match=v*` would return both project tags and `vue-helpers` tags.

The rule is enforced at config load; the resulting error identifies both colliding declarations.

## `release-kit show-tag-prefixes`

Print a per-workspace table of derived tag prefixes, tag counts, and declared legacy prefixes. Also surfaces any release-shaped tag prefix in the repo that is neither a derived prefix nor declared via `legacyIdentities`, along with a copy-pasteable `workspaces: [...]` config snippet. The snippet uses a `TODO-fill-in-legacy-npm-name` placeholder for each identity's `name`; replace it with the package's prior npm name before pasting.

Exits `0` when every workspace derives a prefix and there are no cross-workspace collisions; exits `1` on any derivation failure or collision. Undeclared candidates do not affect the exit code — they surface as a warning via the `legacy tag prefixes are declared` readyup check.

In single-package mode, prints a single row with `workspacePath = .` and `derivedPrefix = v`; legacy entries and undeclared-candidate scanning are not applicable.

## `VersionPatterns`

Defines which commit types trigger major or minor bumps. Any recognized type not listed defaults to a patch bump.

```typescript
interface VersionPatterns {
  major: string[]; // Patterns triggering a major bump ('!' = any breaking change)
  minor: string[]; // Commit types triggering a minor bump
}
```

Default: `{ major: ['!'], minor: ['feat'] }`
