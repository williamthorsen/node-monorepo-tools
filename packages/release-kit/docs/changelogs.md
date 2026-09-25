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
| `hash`        | `string`  | The full commit SHA, which an override key matches by prefix. Absent on synthetic propagation entries.                                                                                                                   |
| `entry`       | `number`  | The 1-based position of the change-record entry from which the item derives, which an override key `<hash>:<n>` matches. Absent on an item derived from the commit's title.                                              |

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
- **An override cannot set it.** `migration` is not a field an override file can set (see [File shape](editorial-overrides.md#file-shape)). On a title-derived item it is re-derived from whatever `body` an override installs, and cleared where that body carries no labeled paragraph, so overriding `body` changes the migration text. An entry-derived item keeps its entry's `migration` whatever `body` an override installs.

The label match is exact: `migration:` and `**Migration:**` are not recognized.

## What reaches a changelog

release-kit splits the history reachable from `HEAD` into one window per release tag that matches the scope's tag prefixes, restricted to commits that touch the scope's `paths`. The bump reads the same items: Its level is the highest that the unreleased window's items call for, so a commit that bumps is one that the changelog lists.

A commit whose last `change-record` block records entries yields its items from those entries, as [Change-record blocks](#change-record-blocks) describes. Any other commit in a window reaches the changelog when its subject passes three checks:

- **A ticket-ID prefix**, such as `#42 `, `TOOL-123 `, or `## `.
- **A declared work type**, resolved against the merged [work types](work-types.md).
- **A type not excluded from the changelog** by `excludedFromChangelog: true`.

`release:` commits and merge commits whose subject git wrote (`Merge …`) never reach a changelog, whether or not they carry a block. A commit that fails a check yields no item and raises no bump, so a window without an item calls for no release. A release forced by `--force` or `--set-version` whose window yields no item records a "Forced version bump." entry under Notes for its version, whether or not the window has commits. Because history does not yield that entry again, `release-kit prepare` keeps it by merging each release's entries with the `changelog.json` on disk. The prepare report lists a commit of the unreleased window that fails the first or the second check as unparseable, unless a malformed-block warning already reports it; it lists none that fails the third. The commit's type decides the section under which its item appears.

### Existing `CHANGELOG.md` sections

`prepare` also reads the `CHANGELOG.md` that it regenerates, so a version recorded only there, such as history written by hand before release-kit was adopted, survives. The first SemVer token in a `##` heading names the section's version: `## 1.2.0`, `## v1.2.0`, and `## [1.2.0] - 2024-01-01` all name 1.2.0, and so does `## Upgrading from 1.2.0`.

- **A version that neither the release windows nor `changelog.json` contain** keeps its section verbatim, placed among the rendered sections in version order.
- **A version that either contains** is rendered from its entries, and its old text is discarded.
- **A section whose heading names no version**, such as `## Unreleased`, is dropped.

The header above the first section and the footer comment are regenerated. The prepare report lists the versions kept for each changelog and warns about each section dropped. Kept sections never enter `changelog.json`.

### Routing to workspaces

A workspace's window contains every commit that touches the workspace's paths. An item derived from a title reaches every workspace whose window contains its commit. An item derived from a change-record entry reaches a workspace in that window only when the entry's `scopes` route it there:

- **A scope that names the workspace's `dir`** routes the item to that workspace. release-kit resolves each scope through [`scopeAliases`](configuration.md) before it compares the scope with the `dir`.
- **`*`, or an empty or absent `scopes`,** routes the item to every workspace in the window.
- **`root`** names no workspace, so it routes the item nowhere and is not reported. A workspace whose `dir` is `root` is the exception: `root` then names that workspace.

A scope narrows the window and never widens it: A scope that names a workspace whose window does not contain the commit routes the item to no workspace, and `prepare` reports it (see [Reported diagnostics](#reported-diagnostics)). The project changelog and a single-package repo take every entry, whatever its scopes.

A workspace's bump reads the items routed to it, so a breaking entry scoped to one workspace does not raise a major bump in another that the same commit touched. A workspace whose window has commits but no routed item calls for no release.

Each `prepare` rebuilds a workspace's released windows with the same routing, so an item that an earlier release recorded under a workspace that its scopes do not name leaves that workspace's past section. A path window does not follow a renamed directory, and legacy identities do not rename scopes: An entry scoped to a workspace's old directory name reaches the workspace only through a `scopeAliases` entry from the old name to the new one, and until one exists, `prepare` reports the scope for each such commit in the unreleased window.

## Change-record blocks

A squash-merge commit composed from a pull request can end with a fenced block whose info string is exactly `change-record`. Its payload is YAML, with the grammar that codeassembly's `change-record.md` specifies. release-kit reads these keys and ignores any other:

| Key                   | Type     | Meaning                                                                                                                                                         |
| --------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entries`             | list     | The change entries, one per outcome of the change, in the order that they read.                                                                                 |
| `entries[].type`      | `string` | A work type, resolved through the declared types and their aliases. Required.                                                                                   |
| `entries[].text`      | `string` | The sentence that reports the outcome. Required.                                                                                                                |
| `entries[].breaking`  | boolean  | Whether the outcome breaks consumers.                                                                                                                           |
| `entries[].scopes`    | list     | The scopes that the outcome touched, each a string. They decide which workspaces receive the entry's item; see [Routing to workspaces](#routing-to-workspaces). |
| `entries[].migration` | `string` | The migration step for a consumer.                                                                                                                              |
| `pr_number`           | integer  | The merged pull request's number, a positive integer.                                                                                                           |
| `ticket_ref`          | `string` | The ticket that the change serves. Validated but not yet used.                                                                                                  |

release-kit reads the **last** `change-record` fence in the message. A key whose value is null reads as absent.

### Items from entries

Each entry routed to the workspace being read yields one item, whether or not the commit subject carries a ticket-ID prefix or a declared type:

- **Section**: the header of the entry's `type`, so the section order and the audience follow as for a title.
- **`description`**: the entry's `text` as written, followed by ` (#N)` when the block records `pr_number`.
- **`breaking`**: set when the entry's `breaking` is `true` and the type's breaking policy permits it.
- **`migration`**: the entry's `migration`, when present. There is no `body`.
- **`hash`** and **`entry`**: the commit's hash, and the entry's 1-based position among all the block's entries, including those that yield no item.

An entry whose type is excluded from the changelog yields no item. An override targets one of these items by the key `<hash>:<n>`, where `n` is the item's `entry`. A bare `<hash>` key matches every item of the commit, and it fails when it sets `description` or `body` on a commit with several items; see [Keys](editorial-overrides.md#keys).

### Fallback to the title

A commit is read from its title, as [What reaches a changelog](#what-reaches-a-changelog) describes, when it has no block, when the block's `entries` is absent or empty, or when the block is malformed. A block is malformed when it never closes, when its payload is not valid YAML or not a mapping, when `entries` is not a list, when an entry is not a mapping, when an entry's `type` or `text` is missing, blank, or not a string, when `breaking` is not a boolean, when `scopes` is not a list of strings, when `migration` or `ticket_ref` is not a string, or when `pr_number` is not a positive integer. One defect makes the whole block malformed.

### Reported diagnostics

`release-kit prepare` reports these as warnings for the release being prepared, from the commits that no earlier release contains:

- **A malformed block**, with the defect that stopped the read.
- **An entry whose type is not declared**, with its position. It yields no item.
- **An entry that violates its type's breaking policy**, as a policy violation at the entry's position. Its item is not marked breaking.
- **An entry scope that names no workspace in its commit's window**, with the commit's hash, the entry's position, and the scope as the entry declares it. release-kit reports it under every workspace whose window contains the commit. A scope that names nothing, or a workspace whose window does not contain the commit, is reported; `*`, `root`, and a scope that names a workspace in the window are not. Under `--only`, a scope that names a configured workspace left out of the run is not reported either. A workspace excluded with `shouldExclude: true` is not a configured workspace, so a scope that names one is reported.

The result that `prepare` returns carries these as `malformedBlocks`, `undeclaredEntryTypes`, `policyViolations` entries whose `surface` is `'entry'`, and `unroutedEntryScopes`, whether the target releases or is skipped. A block whose entries are all undeclared or excluded yields no item, so the commit raises no bump.

## Release-notes injection

With `releaseNotes.shouldInjectIntoReadme` set to `true`, `release-kit publish` writes each package's release notes into its `README.md` for the duration of the publish, then restores the file. The notes are the all-audience sections of the released version's entry in `.meta/changelog.json`, under a `## Release notes — v<version> (<date>)` heading, and they replace whatever lies between the marker pair:

```markdown
<!-- section:release-notes --><!-- /section:release-notes -->
```

A README without the marker pair receives the notes at its top, above its title, and release-kit's readyup kit reports a README that lacks the markers. Injection is skipped with a warning when `changelogJson.enabled` is `false`, when the version has no entry, or when the entry has no all-audience content. `release-kit prepare --with-release-notes` writes the same injected README as a [preview](releasing.md#previewing-release-notes-with---with-release-notes).
