# Labels

How to declare the repository's labels in `.config/release-kit.config.ts`, how the scaffolded workflow applies them, and where the schema for `.meta/label-map.json` is published.

## `release-kit sync-labels`

Manages GitHub label definitions via the `repoLabels` block of `.config/release-kit.config.ts`.

`init` scaffolds the `.github/workflows/sync-labels.yaml` caller workflow and seeds a `repoLabels` block with scope labels discovered from workspaces and declared `retiredPackages`. When `.config/release-kit.config.ts` does not exist, `init` writes it; when it does, `init` prints the block for manual paste; a hand-authored config is never rewritten. `generate` resolves the block and writes `.github/labels.yaml`; with `--check` it regenerates in memory and exits non-zero if the committed file is stale or missing, writing nothing. `sync` triggers the workflow remotely; it requires the `gh` CLI and an existing workflow file.

`init` and `generate` accept `--config <path>` to read a config elsewhere; `sync` reads none and rejects the flag. Under `--config`, `init` reads the named file and prints the block for manual paste, and fails when that file does not exist rather than scaffolding one, so its write target stays `.config/release-kit.config.ts`. See [Config file location](configuration.md#config-file-location).

Every `sync-labels` subcommand refuses to run while the retired `.config/sync-labels.config.ts` is present, so that custom labels cannot be silently dropped mid-migration, and the refusal names what to move and where.

### Label configuration

```typescript
import { defineConfig } from '@williamthorsen/release-kit/config';

export default defineConfig({
  repoLabels: {
    extends: ['common'],
    labels: {
      'scope:my-package': { color: '00ff96' }, // add, with no description
      bug: { color: 'b60205', description: 'Something broken' }, // replace the preset's `bug`
      wontfix: null, // remove the preset's `wontfix`
    },
  },
});
```

The block declares the repository's label registry: the set of labels defined on the GitHub repo, distinct from labels applied to PRs and issues. Resolution is an ordered fold with last-writer-wins:

1. Presets, in `extends` order: A later preset wins on a shared name.
2. The `labels` record: An entry adds a label, replaces one that an earlier layer defined, or removes it (`null`). Replacement is wholesale: An entry omitting `description` resolves to a label without a description rather than inheriting the one that an earlier layer supplied.

The `common` preset defines a label for every work type in change-grammar's taxonomy, named by the type's `trackerLabel`, in addition to the labels in its bundled YAML file.

The bundled file's `confidence:` family grades how advisable a recommendation is, for example one that a triage of spike findings turns into a ticket: `confidence:high` is clearly worth doing, `confidence:medium` is worth doing but arguable, and `confidence:low` is not worth a ticket now.

Names match case-insensitively, as GitHub matches them: `Bug` in the `labels` record replaces a preset's `bug`, and `Bug: null` removes it. A label takes the spelling of the last layer to write it.

`description` is optional throughout, in a preset as in the `labels` record, and `sync-labels init` generates none for a scope label. The generated file spells an absent description `''` because `github-label-sync` reads an omitted description as "leave the label's current one alone"; the empty form clears it. Because a scope label without a description groups compactly in GitHub's label list, release-kit's readyup kit warns about each `scope:` label in the generated file that has one.

Overlaps between layers are never errors; order resolves them, and the committed `.github/labels.yaml` diff shows any unexpected change at review. Three misstatements are config errors, because none is visible in the output diff: a dangling `null`, which removes a name not defined by any preset; `labels` keys that differ only in case, all but one of which the fold would discard; and an alias that names a resolved label or repeats another alias, which would make the sync merge one label into another and delete it (see [Renaming a label](#renaming-a-label)).

### Retiring a label

Mark a label `archived: true` to retire it without losing its history:

```typescript
labels: {
  'scope:basic': { color: '00ff96', archived: true }, // retire the scope of a removed package
},
```

The sync workflow archives a marked label rather than deleting it. An archived label stays on the issues and pull requests that have it, but it cannot be added to new ones and does not appear in the label picker. Removing the mark unarchives the label on the next sync. Removing the entry leaves the label in place: The sync does not delete a label that `.github/labels.yaml` does not declare, and it reports each such label as a warning. To delete a label, run `gh label delete <name>`; the label disappears from every issue and pull request that had it.

The mark is set only in the `labels` record, not in a preset. To retire a preset's label, replace it with an entry that restates its color and adds the mark.

### Renaming a label

List a label's old names in `aliases` to rename it:

```typescript
labels: {
  'scope:core': { color: '00ff96', aliases: ['scope:basic'] }, // rename `scope:basic` to `scope:core`
},
```

The sync renames an existing label that an alias names, in place, rather than deleting it and creating a new one, so the label stays on the issues and pull requests that have it. The dry-run **Label diff** lists the rename. When the repository has both the old name and the new one, the sync adds the new label to every issue and pull request that has the old one, then deletes the old label. A label that an alias names is not reported as undeclared.

`aliases` is set only in the `labels` record, not in a preset, and it takes at least one name. Names match case-insensitively. An alias must not name a label that the config resolves, including the label that declares it, and must not appear twice: Either would make the sync merge one declared label into another and delete it. To rename a preset's label, remove it with `null` and alias it from the new entry:

```typescript
labels: {
  bug: null,
  'type:bug': { color: 'd73a4a', aliases: ['bug'] },
},
```

### When labels are applied

The scaffolded workflow declares three triggers:

| Trigger                                                   | Job     | Token           | Effect                            |
| --------------------------------------------------------- | ------- | --------------- | --------------------------------- |
| Push to the default branch touching `.github/labels.yaml` | `sync`  | `issues: write` | Applies the labels                |
| Manual dispatch (`release-kit sync-labels sync`)          | `sync`  | `issues: write` | Applies the labels                |
| Pull request touching `.github/labels.yaml`               | `check` | `issues: read`  | Logs the diff without applying it |

Applying on merge closes the window in which a regenerated `.github/labels.yaml` remains unapplied. In that window, a later manual dispatch would apply an unreviewed label set.

The `check` job runs the same sync in dry-run. Its **Label diff** log group lists every create, edit, and rename that the sync would perform.

Its **Archive state** log group lists each label that the sync would archive or unarchive. Archiving runs after the rest of the sync, so a label that the file both adds and marks is created and then archived.

Both jobs end with an **Undeclared labels** log group, and they report each repository label that the file does not declare as a warning annotation, which appears on the run and on the pull request's check. A label created by hand, for example to put it on the ticket that will declare it, therefore survives every sync until the file declares it or someone deletes it.

The two jobs are split because a job's permissions are fixed when the run is created and cannot vary by trigger. The split keeps a write-scoped token out of pull-request runs.

The push trigger filters on the path alone; the `sync` job compares `github.ref_name` against the repository's default branch. The workflow therefore doesn't need a per-repo edit, whatever that branch is named, and a push touching `.github/labels.yaml` on any other branch produces a run whose jobs all skip.

Manual dispatch is not a preview. It matches the `sync` job, so it applies the labels; only the pull-request path runs in dry-run.

### Dry-run checks on fork pull requests

GitHub issues a read-only `GITHUB_TOKEN` to pull requests from forks, and by default pauses runs from first-time contributors until a maintainer approves them. Because the dry-run reads labels and writes nothing, the check normally runs once approved. A repo that disables workflows on fork pull requests doesn't get a check at all; to preview such a change, push the branch to the base repo and open the pull request from there.

### JSON Schema for `.meta/label-map.json`

`.meta/label-map.json` is a separate, generic data file that maps commit-prefix scopes and types to GitHub label names. `@williamthorsen/change-grammar` publishes its JSON Schema, reachable via the stable raw URL:

```
https://github.com/williamthorsen/node-monorepo-tools/raw/change-grammar-v<version>/packages/change-grammar/schemas/label-map.json
```

Consumers reference it from the top of their `.meta/label-map.json`:

```json
{
  "$schema": "https://github.com/williamthorsen/node-monorepo-tools/raw/change-grammar-v<version>/packages/change-grammar/schemas/label-map.json",
  "types": { "feat": "feature", "fix": "fix" },
  "scopes": { "audit": "scope:audit" }
}
```

Earlier releases published the same schema from release-kit, and URLs under existing `release-kit-v*` tags keep resolving. release-kit does not generate `.meta/label-map.json`; change-grammar's `deriveLabelMap` derives one from the taxonomy, the workspace scopes, and the caller's statement of whether the repo is a monorepo, which decides the `root` scope.
