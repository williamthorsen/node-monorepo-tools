# Editorial overrides

How to correct a generated changelog entry without rewriting history: where override files live, how they compose, what an entry may set, and how to validate the files.

Generated changelogs occasionally need editorial correction — typos, redacted scope, reworded entries, or historical commits whose bodies carry verbatim PR-template scaffolding (`## What`, `## Why`, etc.) that renders as literal text in user-facing release notes. Rewriting git history is not viable, and any in-place edit to `CHANGELOG.md` or `.meta/changelog.json` is overwritten on the next release because release-kit regenerates both artifacts from scratch.

Override files are the supported escape hatch. Drop a checked-in JSON file at the conventional path for the scope you want to influence, keyed by commit hash, and `release-kit prepare` applies the overrides between `buildChangelogEntries` and serialization. Both `CHANGELOG.md` and `.meta/changelog.json` reflect the post-override view, so downstream consumers (the GitHub Release body, the in-app release-notes page, etc.) see the same content.

## File-location convention

| Scope               | Path                                           | Applies to                                              |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| Project (root)      | `.meta/changelog-overrides.json`               | The project changelog and every workspace's changelog   |
| Workspace           | `packages/<ws>/.meta/changelog-overrides.json` | Only that workspace's changelog                         |
| Single-package mode | `.meta/changelog-overrides.json`               | The package's changelog (collapses to the project case) |

Filenames have no leading dot — the `.meta/` directory already provides the visibility property and parallels its sibling artifacts (`changelog.json`, `label-map.json`).

## Composition: per-key shadowing

When a workspace's changelog is rendered, both files are consulted:

- The root file's overrides apply globally.
- The workspace file's overrides apply only to that workspace.
- When the **same hash key** (string-equal, byte-for-byte) appears in both files, the **workspace entry wins entirely** for that workspace's changelog — no field-level merge, the workspace entry replaces the root entry.
- Different prefix strings that happen to resolve to the same commit do **not** shadow; they fall through to the existing ambiguous-prefix error so you can correct your override file.
- Other keys in the root file still apply for that workspace.

The project-level changelog applies only the root file. Per-workspace files describe per-workspace editorial intent and have no meaning at the aggregated project tier.

## Stale-key warnings

A key that doesn't match any commit gets a stale-reference warning. The warning's scope mirrors the file's scope:

- **Per-workspace files** are warned against their own apply context. A key in `packages/foo/.meta/changelog-overrides.json` that doesn't match any commit in foo's changelog is unambiguously stale and is warned immediately.
- **Root file** keys are aggregated globally — a root key that matches in any workspace or in the project changelog is non-stale; a root key matched nowhere is warned exactly once after all batches complete.

## File shape

```json
{
  "82962311": {
    "audience": "skip"
  },
  "abc1234d": {
    "body": "Cleaned-up prose without the original PR-template scaffolding."
  },
  "ef567890": {
    "description": "Rewritten headline that fixes the typo",
    "body": "Optional replacement body."
  }
}
```

Per-entry fields are all optional, but at least one must be present per entry:

| Field         | Type                       | Effect                                                                                                                            |
| ------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `audience`    | `'all' \| 'dev' \| 'skip'` | `'skip'` removes the entry entirely. `'all'` and `'dev'` are reserved for a future audience-reclassification feature (see below). |
| `description` | `string`                   | Replaces the entry's bullet headline. Other fields are preserved.                                                                 |
| `body`        | `string`                   | Replaces the entry's body (the prose that renders below the bullet). Other fields are preserved.                                  |
| `breaking`    | `boolean`                  | Toggles the `🚨 **Breaking:** ` marker on the bullet.                                                                             |

There is no `migration` key: the field is derived from `body`, so an override that replaces `body` re-derives it. See [The `migration` field](changelogs.md#the-migration-field).

## Hash-prefix matching

Keys can be either the full 40-character commit SHA or a non-ambiguous prefix. The matcher walks every `ChangelogItem.hash` value present in the entry tree and resolves each override key to its set of matching hashes:

- **Exact prefix match (1 hit)** — the override applies. A 7-character prefix is usually unambiguous within a single repo's history; longer prefixes are always safe.
- **No matches (0 hits)** — the override is treated as a stale reference (probably from a rebase or branch deletion) and prepare reports a warning. The release continues.
- **Ambiguous prefix (2+ hits)** — the release aborts with an error naming the key and the matching hashes. Lengthen the prefix or use the full SHA.

Override application errors abort the run with a non-zero exit; warnings (zero-match keys) are non-fatal and surface on `PrepareResult.warnings`.

## Validation

The override file is validated when `release-kit prepare` loads it. Each error names the offending key so you can locate it in your file:

- Missing file → empty map, no error (the no-op default — projects that do not need overrides skip the file entirely).
- Malformed JSON → error.
- Wrong top-level shape (e.g., array, primitive) → error.
- Unknown fields on an entry → error.
- Wrong field types (e.g., `description` as a number) → error.
- An entry with no fields set → error (a copy-paste mistake more often than not).
- `audience: 'all'` or `audience: 'dev'` → error in the current release: only `'skip'` is supported (see below).

### Standalone validation: `release-kit overrides validate`

For a focused overrides-only health check (locally or as a CI gate), run:

```sh
pnpm exec release-kit overrides validate
```

This walks every `.meta/changelog-overrides.json` file across the project tier and per-workspace tier, reporting three classes of finding:

| Class               | Examples                                                                                    | Exit code |
| ------------------- | ------------------------------------------------------------------------------------------- | --------- |
| Schema/parse errors | malformed JSON, unknown fields, wrong field types, no-field entries, unsupported `audience` | `2`       |
| Ambiguous-prefix    | an override key resolves to 2+ commit hashes                                                | `2`       |
| Stale-key warnings  | an override key resolves to no commit in its applicable scope                               | `1`       |

Tier-aware stale-key semantics match `release-kit prepare`'s match-set exactly: a workspace-tier key is stale if it does not match in its own workspace's history; a root-tier key is stale only if it matches in **no** scope (no workspace AND not the project release window).

The same logic is also exposed programmatically via the `validateAllChangelogOverrides` function exported from `@williamthorsen/release-kit`, for callers that want to integrate the check into their own tooling.

## Audience semantics: v1 supports `'skip'` only

The on-disk format declares the full `'all' | 'dev' | 'skip'` audience vocabulary so the file format will not need to change when the v2 reclassification feature ships. In the current release, only `'skip'` is supported at runtime; `'all'` and `'dev'` are rejected with an explicit "not yet supported" error.

The eventual v2 behavior will let an override move a single item to a different audience section (e.g., reclassifying a `Documentation` entry as `Internal features` to keep it out of public-facing release notes). v1 deliberately leaves that as a separate change so the override mechanism can ship now and the section-split logic can land additively later.

## Worked example 1: cleaning up scaffolded historical commits (root file)

Suppose a year-old commit `82962311` was authored from a PR template that left `## What` / `## Why` headings in the body, and that commit now appears in your in-app release notes as literal Markdown headings. Add an override at the project tier:

```json
// .meta/changelog-overrides.json
{
  "82962311": {
    "body": "Add the in-app release-notes page with version-aware navigation."
  }
}
```

On the next `release-kit prepare` run, the matched item's body is replaced before the JSON and Markdown artifacts are written. The original git history is untouched.

## Worked example 2: suppressing a cross-attribution spillover (workspace file)

Release-kit attributes commits to workspaces by file path, so a commit that primarily belongs to one workspace can land in another's changelog if it touched files there. Suppose commit `1ce3d2f` renamed the `audit-deps` package to `v11y-check` (scope `v11y-check`) but also edited `packages/nmr/src/default-scripts.ts` and `packages/nmr/README.md`. The commit correctly appears in `packages/v11y-check/CHANGELOG.md`, but it also spills into `packages/nmr/CHANGELOG.md` where it isn't the right editorial framing.

Drop a workspace-tier override at `packages/nmr/.meta/changelog-overrides.json`:

```json
// packages/nmr/.meta/changelog-overrides.json
{
  "1ce3d2f": {
    "audience": "skip"
  }
}
```

The commit is now suppressed in nmr's changelog only — it still appears in v11y-check's, where it belongs. A root-tier `'skip'` would have removed it from both, which is the wrong outcome.
