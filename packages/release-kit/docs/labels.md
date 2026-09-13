# Labels

How to declare the repository's labels in `.config/release-kit.config.ts`, how the scaffolded workflow applies them, and the published schema for `.meta/label-map.json`.

## `release-kit sync-labels`

Manage GitHub label definitions via the `repoLabels` block of `.config/release-kit.config.ts`.

`init` scaffolds the `.github/workflows/sync-labels.yaml` caller workflow and seeds a `repoLabels` block with scope labels discovered from workspaces and declared `retiredPackages`. When `.config/release-kit.config.ts` does not exist, `init` writes it; when it does, `init` prints the block for manual paste — a hand-authored config is never rewritten. `generate` resolves the block and writes `.github/labels.yaml`; with `--check` it regenerates in memory and exits non-zero if the committed file is stale or missing, writing nothing. `sync` triggers the workflow remotely — it requires the `gh` CLI and an existing workflow file.

Every `sync-labels` subcommand refuses to run while the retired `.config/sync-labels.config.ts` is present, so custom labels cannot be silently dropped mid-migration, and the refusal names what to move and where.

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

The block declares the repository's label registry — the set of labels defined on the GitHub repo, distinct from labels applied to PRs and issues. Resolution is an ordered fold with last-writer-wins:

1. Presets, in `extends` order — a later preset wins on a shared name.
2. The `labels` record — an entry adds a label, replaces one an earlier layer defined, or removes it (`null`). Replacement is wholesale: an entry omitting `description` resolves to no description rather than inheriting the one an earlier layer supplied.

`description` is optional throughout, in a preset as in the `labels` record, and `sync-labels init` generates none for a scope label. The generated file spells an absent description `''` because `github-label-sync` reads an omitted description as "leave the label's current one alone"; the empty form clears it.

Overlaps are never errors; order resolves them, and the committed `.github/labels.yaml` diff is where an unexpected change surfaces at review. The one config error is a dangling `null` — removing a name no preset defines — because that misstatement is invisible in the output diff.

### When labels are applied

The scaffolded workflow carries three triggers:

| Trigger                                                   | Job     | Token           | Effect                            |
| --------------------------------------------------------- | ------- | --------------- | --------------------------------- |
| Push to the default branch touching `.github/labels.yaml` | `sync`  | `issues: write` | Applies the labels                |
| Manual dispatch (`release-kit sync-labels sync`)          | `sync`  | `issues: write` | Applies the labels                |
| Pull request touching `.github/labels.yaml`               | `check` | `issues: read`  | Logs the diff without applying it |

Applying on merge closes the window in which a regenerated `.github/labels.yaml` sits unapplied — a window in which a later manual dispatch would apply a label set nobody reviewed.

The `check` job runs the same sync in dry-run. Its **Label diff** log group lists every create, edit, rename, and deletion the sync would perform, including deletions of labels the file does not declare — the destructive edits a diff of `.github/labels.yaml` alone cannot show, because a label created by hand or by another workflow is absent from the file both before and after. Read that log; the check reports success whether or not the diff is destructive, so a green check is not evidence that nothing will be deleted.

The two jobs are split because a job's permissions are fixed when the run is created and cannot vary by trigger. The split is what keeps a write-scoped token out of pull-request runs.

The push trigger filters on the path alone; the `sync` job compares `github.ref_name` against the repository's default branch. The workflow therefore needs no per-repo edit whatever that branch is named — and a push touching `.github/labels.yaml` on any other branch produces a run whose jobs all skip.

Manual dispatch is not a preview. It matches the `sync` job, so it applies the labels, deletions included; only the pull-request path runs in dry-run.

### Dry-run checks on fork pull requests

GitHub issues a read-only `GITHUB_TOKEN` to pull requests from forks, and by default holds runs from first-time contributors until a maintainer approves them. The dry-run reads labels and writes nothing, so the check normally runs once approved. A repo that disables workflows on fork pull requests gets no check at all; to preview such a change, push the branch to the base repo and open the pull request from there.

### Published JSON Schema for `.meta/label-map.json`

release-kit publishes a JSON Schema for `.meta/label-map.json` — a separate, generic data file that maps commit-prefix scopes and types to GitHub label names. The schema lives at `packages/release-kit/schemas/label-map.json` in this repo and is reachable via the stable raw URL:

```
https://github.com/williamthorsen/node-monorepo-tools/raw/release-kit-v<version>/packages/release-kit/schemas/label-map.json
```

Consumers reference it from the top of their `.meta/label-map.json`:

```json
{
  "$schema": "https://github.com/williamthorsen/node-monorepo-tools/raw/release-kit-v<version>/packages/release-kit/schemas/label-map.json",
  "types": { "feat": "feature", "fix": "fix" },
  "scopes": { "audit": "scope:audit" }
}
```

release-kit publishes the schema only; it does not generate `.meta/label-map.json`. Generation requires commit-prefix knowledge that lives outside release-kit (in agent-conventions tooling), and is owned by those consumers.
