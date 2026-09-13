# Work types and tiers

The taxonomy against which release-kit parses commits: its tiers, the breaking-change policy, section markers, customization, and the commands that compare it with its upstream.

The canonical taxonomy lives in `packages/release-kit/src/work-types.json` and is split into three tiers that drive section rendering and audience classification.

| Tier     | Key         | Header                    | Aliases       | `!` policy   |
| -------- | ----------- | ------------------------- | ------------- | ------------ |
| public   | `feat`      | 🎉 Features               | `feature`     | optional     |
| public   | `drop`      | 🪦 Removed                |               | **required** |
| public   | `deprecate` | 🗑️ Deprecated             |               | forbidden    |
| public   | `fix`       | 🐛 Bug fixes              | `bugfix`      | forbidden    |
| public   | `sec`       | 🔒 Security               | `security`    | optional     |
| public   | `perf`      | ⚡ Performance            | `performance` | forbidden    |
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

Section render order is **tier order (`public` → `internal` → `process`), then row order within tier**. The bundled `cliff.toml.template` encodes this order via hidden `<!-- NN -->` HTML-comment prefixes on each parser's `group` value; tera's `group_by` filter sorts groups lexicographically (now monotonic by row number), and the body template's `striptags` filter erases the prefix from rendered headings.

## `utility` alias

`utility:` is a backward-compat alias for `internal:`. Both forms parse to the same canonical type, route to the same `🏗️ Internal features` section, and are subject to the same `!` policy.

## `!` (breaking change) policy

Each work-type carries a `breakingPolicy` value:

- `optional` (`feat`, `sec`) — `!` is allowed; both `type:` and `type!:` parse cleanly.
- `forbidden` (most types) — `!` is a policy violation. The premise: types like `internal!`, `perf!`, `fix!` are contradictory; an internal change cannot break a consumer contract, a pure perf change preserves the contract, and a bug-fix is by definition not a contract change.
- `required` (`drop`) — bare `drop:` is a policy violation; only `drop!:` is accepted. The premise: removing a feature always breaks consumers; the `!` form makes that explicit.

### Two-tier policy enforcement

The `!` policy operates at two distinct levels with different semantics:

- **Write-time** (commit-msg hook) — strict rejection. Policy violations are blocked at the gate where the author can act on them immediately. _Hook-based enforcement is tracked separately and is not yet shipped._
- **Release-time** (`parseCommitMessage`) — tolerant warn-and-continue. Commits already in the log cannot be rewritten, so a policy-violating commit is parsed using its canonical type with `breaking: false` (the `!` is dropped from the parse) and a `onPolicyViolation` callback fires. Callers (`decideRelease` etc.) can collect these warnings and surface them in the release report. A single legacy `internal!` in a year-old log does not block releases.

A `BREAKING CHANGE:` body footer on a `forbidden`-policy type triggers the same warning path as the prefix `!` does — the spirit of the policy is "internal/perf/etc. cannot be breaking", which must apply to both surfaces.

The release-prepare orchestrators (`releasePrepare`, `releasePrepareMono`, `releasePrepareProject`) apply `DEFAULT_BREAKING_POLICIES` automatically. Violations encountered while parsing each workspace's or project's commit window are collected onto the corresponding result's `policyViolations` field and rendered under the section in the prepare report:

```
arrays
  Found 1 commits since arrays-v1.0.0
  ⚠️  1 policy violation:
      · def5678 'internal!: refactor cache' — type 'internal' at prefix surface
  Bumping versions (patch)...
  📦 1.0.0 → 1.0.1 (patch)
```

To customize, set `breakingPolicies` in `release-kit.config.ts` — provide a partial map to override individual types, or `{}` to disable enforcement entirely (the parser falls back to `'optional'` for any missing type). Violations remain warnings, never failures.

## `🚨 **Breaking:**` bullet marker

Items whose commit subject carries the `!` prefix (e.g. `feat!`, `drop!`, `feat(api)!`) are rendered with a `🚨 **Breaking:** ` prefix on the bullet:

```markdown
- 🚨 **Breaking:** Drop legacy /v1 endpoint
```

Only the prefix `!` triggers this marker. A `BREAKING CHANGE:` body footer on its own does **not** retroactively mark a changelog item as breaking — the changelog signal is tied to the commit-prefix policy. This avoids surprise breaking-marker appearances for older commits written under earlier conventions.

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

`fmt:` commits are recognized by `parseCommitMessage` (they contribute to a patch bump) but `fmt` carries `excludedFromChangelog: true`. The bundled `cliff.toml.template` skips `fmt:` commits at the parser level, so they never appear in `CHANGELOG.md`, `changelog.json`, or release notes. The label and emoji are present in `work-types.json` for schema parity with the codeassembly upstream but never render.

## Custom work types

Work types from your config are merged with these defaults by key — your entries override or extend, they don't replace the full set. Release-notes sections are rendered in the declaration order of the merged work-types record, with any unknown titles trailing the known ones.

The default `devOnlySections` (excluded from public release notes but still written to `CHANGELOG.md`) are derived from the `internal` and `process` tiers (excluding `fmt`). Override via `changelogJson.devOnlySections` in your config; matching is decorator-tolerant, so a bare-name override like `['Internal features']` keeps working against the emoji-prefixed and prefix-decorated default titles.

## `release-kit work-types`

Manage the canonical work-types taxonomy used by changelog and release-notes generation.

The check is non-blocking initially: until codeassembly publishes its `work-types.json`, the upstream URL returns 404 and `check` exits 0 with a warning. CI flip to a blocking check is tracked as a follow-up once the upstream ships.

These commands are also exposed as `nmr work-types:check` / `nmr work-types:sync` from any package directory.

### Authenticated fetches

When the upstream codeassembly repo is private, both `check` and `sync` need a GitHub token to fetch the canonical `work-types.json`. Set `GITHUB_TOKEN` in the environment and the commands send `Authorization: Bearer <token>` automatically; without it, requests are unauthenticated and a private upstream will return 404.

```sh
# Source from `gh auth` for local runs:
export GITHUB_TOKEN=$(gh auth token)
pnpm exec release-kit work-types check
```

The token needs `contents: read` on the codeassembly repo (fine-grained PAT scope) or the equivalent classic-PAT scope. A token without sufficient scope still produces a 404 — same response as a missing upstream — so a misconfigured token degrades to the transitional-warning path rather than failing loudly. CI wiring against private upstream is deferred until either codeassembly is publicly readable or a cross-repo PAT is provisioned as a workflow secret.
