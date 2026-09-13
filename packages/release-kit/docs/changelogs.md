# Changelogs

What reaches a published tarball, what each `.meta/changelog.json` item contains, how the git-cliff config is resolved, and how release notes reach a README.

Neither `CHANGELOG.md` nor `.meta/changelog.json` reaches a published tarball on its own. npm stopped including `CHANGELOG` automatically in npm 7, so a package that declares a `files` field ships a changelog only where that field names `CHANGELOG.md` and `.meta/changelog.json`. release-kit's readyup kit reports a publishable workspace whose `files` field omits either.

## `changelog.json` item schema

Each item under a section in `.meta/changelog.json` carries one required field and four optional ones:

| Field         | Type      | Meaning                                                                                                                                        |
| ------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `description` | `string`  | The bullet headline, taken from the commit subject with the ticket ID and type prefix stripped.                                                |
| `body`        | `string`  | The commit body, with trailing trailer metadata stripped.                                                                                      |
| `breaking`    | `boolean` | Present and `true` where the commit subject carried the `!` prefix. See [`!` (breaking change) policy](work-types.md#-breaking-change-policy). |
| `migration`   | `string`  | The migration step for a consumer. See below.                                                                                                  |
| `hash`        | `string`  | The full commit SHA, and the key on which an override entry matches. Absent on synthetic propagation entries.                                  |

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

- **It is independent of `breaking`.** A `fix` cannot carry `!` under the default breaking policy, and a `fix` that tightens validation still imposes a migration. Filter on `migration` to find every step; filter on `breaking` to find every breaking change.
- **`body` keeps the paragraph.** The field is an extraction, not a move, so `CHANGELOG.md` and `.meta/changelog.json` go on agreeing.
- **It is derived, not authored.** `migration` is not a field an override file can set (see [File shape](editorial-overrides.md#file-shape)); it is re-derived from whatever `body` an override installs, and cleared where that body carries no labeled paragraph. To change the migration text, override `body`.

The label match is exact: `migration:` and `**Migration:**` are not recognized.

## cliff.toml setup

The package includes a bundled `cliff.toml.template` that is used automatically when no custom config is found. The resolution order:

| Priority | Path                          | Notes                                           |
| -------- | ----------------------------- | ----------------------------------------------- |
| 1        | `cliffConfigPath` in config   | Explicit path, returned without existence check |
| 2        | `.config/git-cliff.toml`      | Project-level override                          |
| 3        | `cliff.toml`                  | Repo root fallback                              |
| 4        | Bundled `cliff.toml.template` | Automatic fallback                              |

The bundled template provides a generic git-cliff configuration that:

- Strips issue-ticket prefixes matching `^[A-Z]+-\d+\s+` (e.g., `TOOL-123 `, `AFG-456 `)
- Handles both `type: description` and `workspace|type: description` commit formats
- Groups commits by work type via `[git].commit_parsers`

The body template is intentionally empty: release-kit reads cliff's `--context` JSON output and renders `CHANGELOG.md` in-process via `renderChangelogMarkdown` (see [How it works](../README.md#how-it-works) for the rationale). The `[git].commit_parsers` section remains load-bearing for `--context` group assignment.

To customize, scaffold a local copy with `release-kit init --with-config` and edit `.config/git-cliff.toml`. Edit only the `[git]` section — body-template changes have no effect.

## Release-notes injection

With `releaseNotes.shouldInjectIntoReadme` set to `true`, `release-kit publish` writes each package's release notes into its `README.md` for the duration of the publish, then restores the file. The notes are the all-audience sections of the released version's entry in `.meta/changelog.json`, under a `## Release notes — v<version> (<date>)` heading, and they replace whatever lies between the marker pair:

```markdown
<!-- section:release-notes --><!-- /section:release-notes -->
```

A README without the marker pair receives the notes at its top, above its title, and release-kit's readyup kit reports a README that lacks the markers. Injection is skipped with a warning when `changelogJson.enabled` is `false`, when the version has no entry, or when the entry has no all-audience content. `release-kit prepare --with-release-notes` writes the same injected README as a [preview](releasing.md#previewing-release-notes-with---with-release-notes).
