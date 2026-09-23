# Changelogs

What reaches a published tarball, what each `.meta/changelog.json` item contains, which commits reach a changelog, how a merge commit's change-record block becomes items, and how release notes reach a README.

Neither `CHANGELOG.md` nor `.meta/changelog.json` reaches a published tarball on its own. npm stopped including `CHANGELOG` automatically in npm 7, so a package that declares a `files` field ships a changelog only where that field names `CHANGELOG.md` and `.meta/changelog.json`. release-kit's readyup kit reports a publishable workspace whose `files` field omits either.

## `changelog.json` item schema

Each item under a section in `.meta/changelog.json` carries one required field and five optional ones:

| Field         | Type      | Meaning                                                                                                                                                                                                                  |
| ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `description` | `string`  | The bullet headline, taken from the commit subject with the ticket ID and type prefix stripped, or from a change-record entry's `text` (see [Change-record blocks](#change-record-blocks)).                              |
| `body`        | `string`  | The commit body, with trailing trailer metadata and any `change-record` block stripped. Absent on an item derived from a change-record entry.                                                                            |
| `breaking`    | `boolean` | Present and `true` where the commit subject carried the `!` prefix, or the change-record entry set `breaking: true`, and the type permits it. See [`!` (breaking change) policy](work-types.md#-breaking-change-policy). |
| `migration`   | `string`  | The migration step for a consumer. See below.                                                                                                                                                                            |
| `hash`        | `string`  | The full commit SHA, and the key on which an override entry matches. Absent on synthetic propagation entries.                                                                                                            |
| `entry`       | `number`  | The 1-based position of the change-record entry from which the item derives. Absent on an item derived from the commit's title.                                                                                          |

Every optional field is omitted rather than emitted as `null`, so a consumer tests for presence.

### The `migration` field

A commit body states a migration step as a paragraph opening with the literal label `Migration:`. Where one is present, `migration` carries that paragraph with the label stripped. An item derived from a change-record entry takes `migration` from the entry instead, and has no `body`.

A title-derived item looks like this:

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

A commit whose last `change-record` block records entries yields its items from those entries, as [Change-record blocks](#change-record-blocks) describes. Any other commit in a window reaches the changelog when its subject passes three checks:

- **A ticket-ID prefix**, such as `#42 `, `TOOL-123 `, or `## `.
- **A declared work type**, resolved against the merged [work types](work-types.md).
- **A type not excluded from the changelog** by `excludedFromChangelog: true`.

`release:` commits and merge commits whose subject git wrote (`Merge …`) never reach a changelog, whether or not they carry a block. A commit that fails a check is dropped with no error, and a release left with no surviving commit gets no changelog entry. The commit's type decides the section under which its item appears.

Every item of a commit reaches every workspace whose window contains the commit, because windows are selected by the paths that the commit touches.

## Change-record blocks

A squash-merge commit composed from a pull request can end with a fenced block whose info string is exactly `change-record`. Its payload is YAML, with the grammar that codeassembly's `change-record.md` specifies. release-kit reads these keys and ignores any other:

| Key                   | Type     | Meaning                                                                         |
| --------------------- | -------- | ------------------------------------------------------------------------------- |
| `entries`             | list     | The change entries, one per outcome of the change, in the order that they read. |
| `entries[].type`      | `string` | A work type, resolved through the declared types and their aliases. Required.   |
| `entries[].text`      | `string` | The sentence that reports the outcome. Required.                                |
| `entries[].breaking`  | boolean  | Whether the outcome breaks consumers.                                           |
| `entries[].scopes`    | list     | The scopes that the outcome touched, each a string. Validated but not yet used. |
| `entries[].migration` | `string` | The migration step for a consumer.                                              |
| `pr_number`           | integer  | The merged pull request's number, a positive integer.                           |
| `ticket_ref`          | `string` | The ticket that the change serves. Validated but not yet used.                  |

release-kit reads the **last** `change-record` fence in the message. A key whose value is null reads as absent.

### Items from entries

Each entry yields one item, whether or not the commit subject carries a ticket-ID prefix or a declared type:

- **Section**: the header of the entry's `type`, so the section order and the audience follow as for a title.
- **`description`**: the entry's `text` as written, followed by ` (#N)` when the block records `pr_number`.
- **`breaking`**: set when the entry's `breaking` is `true` and the type's breaking policy permits it.
- **`migration`**: the entry's `migration`, when present. There is no `body`.
- **`hash`** and **`entry`**: the commit's hash, and the entry's 1-based position among all the block's entries, including those that yield no item.

An entry whose type is excluded from the changelog yields no item. A bare-hash override key matches every item of the commit, so an override `description` replaces the text of each.

### Fallback to the title

A commit is read from its title, as [What reaches a changelog](#what-reaches-a-changelog) describes, when it has no block, when the block's `entries` is absent or empty, or when the block is malformed. A block is malformed when it never closes, when its payload is not valid YAML or not a mapping, when `entries` is not a list, when an entry is not a mapping, when an entry's `type` or `text` is missing, blank, or not a string, when `breaking` is not a boolean, when `scopes` is not a list of strings, when `migration` or `ticket_ref` is not a string, or when `pr_number` is not a positive integer. One defect makes the whole block malformed.

### Reported diagnostics

`release-kit prepare` reports these as warnings for the release being prepared, from the commits that no earlier release contains:

- **A malformed block**, with the defect that stopped the read.
- **An entry whose type is not declared**, with its position. It yields no item.
- **An entry that violates its type's breaking policy**, as a policy violation at the entry's position. Its item is not marked breaking.

The result that `prepare` returns carries these as `malformedBlocks`, `undeclaredEntryTypes`, and `policyViolations` entries whose `surface` is `'entry'`.

## Release-notes injection

With `releaseNotes.shouldInjectIntoReadme` set to `true`, `release-kit publish` writes each package's release notes into its `README.md` for the duration of the publish, then restores the file. The notes are the all-audience sections of the released version's entry in `.meta/changelog.json`, under a `## Release notes — v<version> (<date>)` heading, and they replace whatever lies between the marker pair:

```markdown
<!-- section:release-notes --><!-- /section:release-notes -->
```

A README without the marker pair receives the notes at its top, above its title, and release-kit's readyup kit reports a README that lacks the markers. Injection is skipped with a warning when `changelogJson.enabled` is `false`, when the version has no entry, or when the entry has no all-audience content. `release-kit prepare --with-release-notes` writes the same injected README as a [preview](releasing.md#previewing-release-notes-with---with-release-notes).
