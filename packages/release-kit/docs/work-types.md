# Work types and tiers

The taxonomy against which release-kit parses commits: its tiers, the breaking-change policy, section markers, and customization.

release-kit reads the taxonomy from `CANONICAL_TAXONOMY` in [`@williamthorsen/change-grammar`](https://github.com/williamthorsen/node-monorepo-tools/tree/main/packages/change-grammar#readme), which also parses commit subjects. The taxonomy is split into three tiers that determine section rendering and audience classification.

| Tier     | Key         | Header                    | Aliases       | `!` policy |
| -------- | ----------- | ------------------------- | ------------- | ---------- |
| public   | `feat`      | 🎉 Features               | `feature`     | optional   |
| public   | `drop`      | 🪦 Removed                |               | optional   |
| public   | `deprecate` | 🗑️ Deprecated             |               | forbidden  |
| public   | `fix`       | 🐛 Bug fixes              | `bugfix`      | optional   |
| public   | `sec`       | 🔒 Security               | `security`    | optional   |
| public   | `perf`      | ⚡ Performance            | `performance` | optional   |
| internal | `internal`  | 🏗️ Internal features      | `utility`     | forbidden  |
| internal | `refactor`  | ♻️ Refactoring            |               | forbidden  |
| internal | `tests`     | 🧪 Tests                  | `test`        | forbidden  |
| process  | `tooling`   | ⚙️ Tooling                |               | forbidden  |
| process  | `ci`        | 👷 CI                     |               | forbidden  |
| process  | `deps`      | 📦 Dependencies           | `dep`         | forbidden  |
| process  | `ai`        | 🤖 Agentic support        |               | forbidden  |
| process  | `docs`      | 📚 Documentation          | `doc`         | forbidden  |
| process  | `fmt`       | (excluded from changelog) |               | forbidden  |

## Tier semantics

- **`public`**: Visible to all audiences. `public`-tier sections appear in both public release notes and dev changelogs.
- **`internal`**: Dev-only. `internal`-tier sections appear in dev changelogs but not in public-facing release notes.
- **`process`**: Dev-only. Same audience treatment as `internal`.

Section render order is **tier order (`public` → `internal` → `process`), then row order within tier**. It comes from the declaration order of `CANONICAL_TAXONOMY`: `CANONICAL_SECTION_ORDER` in `buildChangelogEntries.ts` indexes each header by its row, and `transformReleases` sorts a release's sections by that index whatever order the commits arrived in.

## Subject forms

`classifyChangelogCommit` resolves a commit's type through `parseCommitMessage`, so a subject maps to its section under any form that the parser accepts: `type:`, `scope|type:`, and the conventional-commit `type(scope):`, each followed by a space and a title. A subject combining both scope forms, such as `web|feat(api):`, does not parse. The type is matched case-insensitively: `Feat:` and `FEAT:` resolve like `feat:`. The ticket-ID prefix is still required, and an alias resolves before the section is chosen. A commit whose [change-record block](changelogs.md#change-record-blocks) records entries takes its sections from the entries' types instead of from its subject.

## `utility` alias

`utility:` is a backward-compat alias for `internal:`. Both forms parse to the same canonical type, appear under the same `🏗️ Internal features` section, and are subject to the same `!` policy.

## `!` (breaking change) policy

Each work-type has a `breakingPolicy` value:

- `optional` (`feat`, `drop`, `fix`, `sec`, `perf`): `!` is allowed; both `type:` and `type!:` parse cleanly. Any of these can break consumers, and the marker records when one does: A removal breaks consumers only when the removed surface was published, a fix can break consumers who relied on the defective behavior, and a performance change can break a contract to achieve its gain.
- `forbidden` (`deprecate` and every `internal`- and `process`-tier type): `!` is a policy violation. Deprecating a surface keeps it working, and removing it is a `drop`. Internal- and process-tier work does not face consumers; a change that breaks consumers faces them and therefore takes a public-tier type.

### Policy enforcement

`parseCommitMessage` enforces the `!` policy at release time and treats a violation as a warning. Commits already in the log cannot be rewritten, so a policy-violating commit is parsed using its canonical type with `breaking: false` (the `!` is dropped from the parse) and an `onPolicyViolation` callback fires. `readReleaseHistory` collects these warnings while it builds the items of the unreleased window, and the release report lists them. A single legacy `internal!` in a year-old log does not block releases.

A `BREAKING CHANGE:` body footer on a `forbidden`-policy type triggers the same warning path as the prefix `!` does: A type that cannot be breaking is parsed as non-breaking whichever surface has the signal. The warning is all that a footer triggers; it doesn't raise a bump (see [`🚨 **Breaking:**` bullet marker](#-breaking-bullet-marker)).

The release-prepare orchestrators (`releasePrepare`, `releasePrepareMono`, `releasePrepareProject`) apply `DEFAULT_BREAKING_POLICIES` automatically. Violations in the titles and change-record entries of each workspace's or project's unreleased window are collected onto the corresponding result's `policyViolations` field, on a skipped result as on a released one, and rendered under the section in the prepare report:

```
arrays
  Found 1 commits since arrays-v1.0.0
  🟠 1 policy violation:
      · def5678 'internal!: refactor cache' — type 'internal' at prefix surface
  Bumping versions (patch)...
  📦 1.0.0 → 1.0.1 (patch)
```

To customize, set `breakingPolicies` in `release-kit.config.ts`. The map replaces the default policies rather than merging with them, and the parser treats any type that the map omits as `'optional'`: A config that changes one type lists every policy that it keeps, and `{}` disables enforcement entirely. Violations remain warnings, never failures.

## `🚨 **Breaking:**` bullet marker

Items whose commit subject has the `!` prefix (e.g. `feat!`, `drop!`, `feat(api)!`) on a type whose policy permits it are rendered with a `🚨 **Breaking:** ` prefix on the bullet:

```markdown
- 🚨 **Breaking:** Drop legacy /v1 endpoint
```

The marker agrees with the version bump:

- A `forbidden`-policy type with `!`, such as `refactor!`, doesn't get a marker, just as its `!` doesn't raise a bump; the prepare report lists it as a policy violation. An [editorial override](editorial-overrides.md) that sets `breaking: true` restores the marker for one entry.
- The configured `breakingPolicies` map, `{}` included, decides which types permit the marker.
- A commit whose type the parser cannot resolve doesn't appear in any changelog, so the question of a marker doesn't arise.

A `BREAKING CHANGE:` body footer on its own does **not** retroactively mark a changelog item as breaking, even on a type whose policy permits `!`; the changelog signal is tied to the commit prefix. This avoids surprise breaking-marker appearances for older commits written under earlier conventions. Because the bump follows the items, a footer doesn't raise a major bump either: A consumer that marks breaking changes with the footer alone gets the bump of the commit's type.

The emoji and label of this marker come from the `markers.breaking` entry of `CANONICAL_TAXONOMY` (see [Section markers](#section-markers)), which is also the source for consumers that render their own breaking-changes section.

## Section markers

Alongside `tiers` and `types`, `CANONICAL_TAXONOMY` declares a top-level `markers` object for cross-cutting section markers: visual indicators that aren't tied to a specific work type. Today its only entry is `breaking`.

```jsonc
{
  "markers": {
    "breaking": { "emoji": "🚨", "label": "Breaking" },
  },
}
```

Entries store plain text only, so that the taxonomy stays format-agnostic: Consumers apply their own emphasis (Markdown bold, ANSI escape, HTML `<strong>`) when constructing the rendered form. release-kit's own renderer constructs the per-bullet prefix as `${emoji} **${label}:** ` from this entry.

## `fmt`

`fmt:` commits are recognized by `parseCommitMessage`, but `fmt` sets `excludedFromChangelog: true`, which `DEFAULT_WORK_TYPES` copies onto its `WorkTypeConfig`. `classifyChangelogCommit` excludes a commit whose type sets the flag, so a `fmt:` commit never appears in `CHANGELOG.md`, `changelog.json`, or release notes. Because it doesn't yield an item, it doesn't raise a bump, and the release report does not list it as unparseable. The taxonomy declares a label and emoji for `fmt` like any other type, but they never render.

## Custom work types

Work types from a config are merged with these defaults by key: A consumer entry overrides or extends, it does not replace the full set. `classifyChangelogCommit` reads the merged record, so an added type appears in the changelog under the `header` that it declares, and an entry setting `excludedFromChangelog: true` keeps its commits out of the changelog and the bump. Release-notes sections are rendered in the declaration order of the merged work-types record, with any unknown titles trailing the known ones.

The default `devOnlySections` (excluded from public release notes but still written to `CHANGELOG.md`) are derived from the `internal` and `process` tiers (excluding `fmt`). Override via `changelogJson.devOnlySections`; matching is decorator-tolerant: A bare-name override like `['Internal features']` keeps working against the emoji-prefixed default titles.
