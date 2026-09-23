# Work types and tiers

The taxonomy against which release-kit parses commits: its tiers, the breaking-change policy, section markers, customization, and the maintainer scripts that keep release-kit's copy level with its upstream.

release-kit bundles a copy of the codeassembly canonical taxonomy in `packages/release-kit/src/work-types.json`, kept level by the [maintainer scripts](#maintaining-the-bundled-taxonomy). The taxonomy is split into three tiers that drive section rendering and audience classification.

| Tier     | Key         | Header                    | Aliases       | `!` policy   |
| -------- | ----------- | ------------------------- | ------------- | ------------ |
| public   | `feat`      | 🎉 Features               | `feature`     | optional     |
| public   | `drop`      | 🪦 Removed                |               | **required** |
| public   | `deprecate` | 🗑️ Deprecated             |               | forbidden    |
| public   | `fix`       | 🐛 Bug fixes              | `bugfix`      | optional     |
| public   | `sec`       | 🔒 Security               | `security`    | optional     |
| public   | `perf`      | ⚡ Performance            | `performance` | optional     |
| internal | `internal`  | 🏗️ Internal features      | `utility`     | forbidden    |
| internal | `refactor`  | ♻️ Refactoring            |               | forbidden    |
| internal | `tests`     | 🧪 Tests                  | `test`        | forbidden    |
| process  | `tooling`   | ⚙️ Tooling                |               | forbidden    |
| process  | `ci`        | 👷 CI                     |               | forbidden    |
| process  | `deps`      | 📦 Dependencies           | `dep`         | forbidden    |
| process  | `ai`        | 🤖 Agentic support        |               | forbidden    |
| process  | `docs`      | 📚 Documentation          | `doc`         | forbidden    |
| process  | `fmt`       | (excluded from changelog) |               | forbidden    |

## Tier semantics

- **`public`** — visible to all audiences. `public`-tier sections appear in both public release notes and dev changelogs.
- **`internal`** — dev-only. `internal`-tier sections appear in dev changelogs but not in public-facing release notes.
- **`process`** — dev-only. Same audience treatment as `internal`.

Section render order is **tier order (`public` → `internal` → `process`), then row order within tier**. It comes from the declaration order of `work-types.json`: `CANONICAL_SECTION_ORDER` in `buildChangelogEntries.ts` indexes each header by its row, and `transformReleases` sorts a release's sections by that index whatever order the commits arrived in.

## Subject forms

`classifyChangelogCommit` resolves a commit's type through `parseCommitMessage`, so a subject reaches its section under any form that parser accepts: `type:`, `scope|type:`, and the conventional-commit `type(scope):`. The type is matched case-insensitively, so `Feat:` and `FEAT:` resolve like `feat:`. The ticket-ID prefix is still required, and an alias resolves before the section is chosen. A commit whose [change-record block](changelogs.md#change-record-blocks) records entries takes its sections from the entries' types instead of from its subject.

## `utility` alias

`utility:` is a backward-compat alias for `internal:`. Both forms parse to the same canonical type, route to the same `🏗️ Internal features` section, and are subject to the same `!` policy.

## `!` (breaking change) policy

Each work-type carries a `breakingPolicy` value:

- `optional` (`feat`, `fix`, `sec`, `perf`): `!` is allowed; both `type:` and `type!:` parse cleanly. Any of these can break consumers, and the marker records when one does: A fix can break consumers who relied on the defective behavior, and a performance change can break a contract to achieve its gain.
- `forbidden` (`deprecate` and every `internal`- and `process`-tier type): `!` is a policy violation. Deprecating a surface keeps it working, and removing it is a `drop`. Internal- and process-tier work does not face consumers; a change that breaks consumers faces them and therefore takes a public-tier type.
- `required` (`drop`): Bare `drop:` is a policy violation; only `drop!:` is accepted. Removing a public surface always breaks consumers, and the `!` form makes that explicit.

### Policy enforcement

`parseCommitMessage` enforces the `!` policy at release time and treats a violation as a warning. Commits already in the log cannot be rewritten, so a policy-violating commit is parsed using its canonical type with `breaking: false` (the `!` is dropped from the parse) and an `onPolicyViolation` callback fires. `readReleaseHistory` collects these warnings while it builds the items of the unreleased window, and the release report lists them. A single legacy `internal!` in a year-old log does not block releases.

A `BREAKING CHANGE:` body footer on a `forbidden`-policy type triggers the same warning path as the prefix `!` does: A type that cannot be breaking is parsed as non-breaking whichever surface carries the signal. The warning is all that a footer triggers; it raises no bump (see [`🚨 **Breaking:**` bullet marker](#-breaking-bullet-marker)).

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

Items whose commit subject carries the `!` prefix (e.g. `feat!`, `drop!`, `feat(api)!`) on a type whose policy permits it are rendered with a `🚨 **Breaking:** ` prefix on the bullet:

```markdown
- 🚨 **Breaking:** Drop legacy /v1 endpoint
```

The marker agrees with the version bump:

- A `forbidden`-policy type carrying `!`, such as `refactor!`, gets no marker, just as its `!` raises no bump; the prepare report lists it as a policy violation. An [editorial override](editorial-overrides.md) that sets `breaking: true` restores the marker for one entry.
- The configured `breakingPolicies` map, `{}` included, decides which types permit the marker.
- A commit whose type the parser cannot resolve reaches no changelog at all, so no marker question arises.

A `BREAKING CHANGE:` body footer on its own does **not** retroactively mark a changelog item as breaking, even on a type whose policy permits `!`; the changelog signal is tied to the commit prefix. This avoids surprise breaking-marker appearances for older commits written under earlier conventions. The bump follows the items, so a footer raises no major bump either: A consumer that marks breaking changes with the footer alone gets the bump of the commit's type.

The emoji and label of this marker are sourced from the `markers.breaking` entry in `work-types.json` (see [Section markers](#section-markers)) so consumers that render their own breaking-changes section draw from the same SSOT.

## Section markers

Alongside `tiers` and `types`, `work-types.json` exposes a top-level `markers` object for cross-cutting section markers — visual indicators that aren't tied to a specific work type. Today the canonical entry is `breaking`; additional keys (e.g., security advisories, migration notices) can be added without a schema change.

```jsonc
{
  "markers": {
    "breaking": { "emoji": "🚨", "label": "Breaking" },
  },
}
```

Entries store plain text only — the SSOT is format-agnostic, so consumers apply their own emphasis (Markdown bold, ANSI escape, HTML `<strong>`) when constructing the rendered form. release-kit's own renderer constructs the per-bullet prefix as `${emoji} **${label}:** ` from this entry.

## `fmt`

`fmt:` commits are recognized by `parseCommitMessage`, but `fmt` carries `excludedFromChangelog: true`, which `DEFAULT_WORK_TYPES` carries onto its `WorkTypeConfig`. `classifyChangelogCommit` excludes a commit whose type sets the flag, so a `fmt:` commit never appears in `CHANGELOG.md`, `changelog.json`, or release notes. It yields no item, so it raises no bump, and the release report does not list it as unparseable. The label and emoji are present in `work-types.json` for schema parity with the codeassembly upstream but never render.

## Custom work types

Work types from a config are merged with these defaults by key: a consumer entry overrides or extends, it does not replace the full set. `classifyChangelogCommit` reads the merged record, so an added type reaches the changelog under the `header` it declares, and an entry setting `excludedFromChangelog: true` keeps its commits out of the changelog and the bump. Release-notes sections are rendered in the declaration order of the merged work-types record, with any unknown titles trailing the known ones.

The default `devOnlySections` (excluded from public release notes but still written to `CHANGELOG.md`) are derived from the `internal` and `process` tiers (excluding `fmt`). Override via `changelogJson.devOnlySections`; matching is decorator-tolerant, so a bare-name override like `['Internal features']` keeps working against the emoji-prefixed default titles.

## Maintaining the bundled taxonomy

`src/workTypesData.ts` mirrors `src/work-types.json` for runtime use. Two maintainer scripts of the release-kit package compare that JSON with its codeassembly upstream and update it. They exist only in a checkout of this repository and are not part of the published `release-kit` CLI.

- `nmr work-types:check` compares the content of `src/work-types.json` with the upstream, ignoring the local `$schema` hint.
- `nmr work-types:sync` overwrites `src/work-types.json` with the upstream when their content differs.

Both run from `packages/release-kit`, or from anywhere in the repository as `nmr -F @williamthorsen/release-kit work-types:check` and `nmr -F @williamthorsen/release-kit work-types:sync`. After `sync` writes the file, update `src/workTypesData.ts` to match; `workTypesData.unit.test.ts` fails until the two agree.

`check` exits 0 on a match, 1 on drift, 2 when the upstream fetch fails, and 3 when either file is not valid JSON or the upstream fails the shape check. When the upstream URL returns 404, `check` exits 0 with a warning.

### Authenticated fetches

The upstream codeassembly repo is public, so `check` and `sync` need no token. When `GITHUB_TOKEN` is set in the environment, both scripts send it as `Authorization: Bearer <token>`.
