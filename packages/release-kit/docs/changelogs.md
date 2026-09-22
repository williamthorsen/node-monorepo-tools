# Changelogs

What reaches a published tarball, what each `.meta/changelog.json` item contains, which commits reach a changelog, and how release notes reach a README.

Neither `CHANGELOG.md` nor `.meta/changelog.json` reaches a published tarball on its own. npm stopped including `CHANGELOG` automatically in npm 7, so a package that declares a `files` field ships a changelog only where that field names `CHANGELOG.md` and `.meta/changelog.json`. release-kit's readyup kit reports a publishable workspace whose `files` field omits either.

## `changelog.json` item schema

Each item under a section in `.meta/changelog.json` carries one required field and four optional ones:

| Field         | Type      | Meaning                                                                                                                                                                         |
| ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description` | `string`  | The bullet headline, taken from the commit subject with the ticket ID and type prefix stripped.                                                                                 |
| `body`        | `string`  | The commit body, with trailing trailer metadata stripped.                                                                                                                       |
| `breaking`    | `boolean` | Present and `true` where the commit subject carried the `!` prefix and the commit's type permits it. See [`!` (breaking change) policy](work-types.md#-breaking-change-policy). |
| `migration`   | `string`  | The migration step for a consumer. See below.                                                                                                                                   |
| `hash`        | `string`  | The full commit SHA, and the key on which an override entry matches. Absent on synthetic propagation entries.                                                                   |

Every optional field is omitted rather than emitted as `null`, so a consumer tests for presence.

### The `migration` field

A commit body states a migration step as a paragraph opening with the literal label `Migration:`. Where one is present, `migration` carries that paragraph with the label stripped:

```jsonc
{
  "description": "Rename the workspace field",
  "body": "Renames `name` to `id`.\n\nMigration: Change any uses of `name` to `id`.",
  "migration": "Change any uses of `name` to `id`.",
}
```

Three properties are worth knowing:

- **It is independent of `breaking`.** A `deprecate` cannot carry `!` under the default breaking policy, and a `deprecate` still calls for a migration. Filter on `migration` to find every step; filter on `breaking` to find every breaking change.
- **`body` keeps the paragraph.** The field is an extraction, not a move, so `CHANGELOG.md` and `.meta/changelog.json` go on agreeing.
- **It is derived, not authored.** `migration` is not a field an override file can set (see [File shape](editorial-overrides.md#file-shape)); it is re-derived from whatever `body` an override installs, and cleared where that body carries no labeled paragraph. To change the migration text, override `body`.

The label match is exact: `migration:` and `**Migration:**` are not recognized.

## What reaches a changelog

release-kit splits the history reachable from `HEAD` into one window per release tag that matches the scope's tag prefixes, restricted to commits that touch the scope's `paths`. The bump reads the same windows, so a commit counted toward a version bump is one that the changelog also considers.

A commit in a window reaches the changelog when its subject passes three checks:

- **A ticket-ID prefix**, such as `#42 `, `TOOL-123 `, or `## `.
- **A declared work type**, resolved against the merged [work types](work-types.md).
- **A type not excluded from the changelog** by `excludedFromChangelog: true`.

`release:` commits and merge commits never reach a changelog. A commit that fails a check is dropped with no error, and a release left with no surviving commit gets no changelog entry. The commit's type decides the section under which its item appears.

## Release-notes injection

With `releaseNotes.shouldInjectIntoReadme` set to `true`, `release-kit publish` writes each package's release notes into its `README.md` for the duration of the publish, then restores the file. The notes are the all-audience sections of the released version's entry in `.meta/changelog.json`, under a `## Release notes — v<version> (<date>)` heading, and they replace whatever lies between the marker pair:

```markdown
<!-- section:release-notes --><!-- /section:release-notes -->
```

A README without the marker pair receives the notes at its top, above its title, and release-kit's readyup kit reports a README that lacks the markers. Injection is skipped with a warning when `changelogJson.enabled` is `false`, when the version has no entry, or when the entry has no all-audience content. `release-kit prepare --with-release-notes` writes the same injected README as a [preview](releasing.md#previewing-release-notes-with---with-release-notes).
