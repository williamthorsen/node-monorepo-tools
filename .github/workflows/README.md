<!-- readme-type: config -->

# Workflows

## Naming convention

- **Caller workflows:** `{name}.yaml`, repo-specific workflows that trigger on events (e.g., `workflow_dispatch`) and delegate to a reusable workflow.
- **Reusable workflows:** `{name}.reusable.yaml`, shared workflows invoked via `workflow_call`. The Versioning section below covers how callers reach them.

## Consumer requirements

`audit`, `create-github-release`, and `publish` install pnpm with [`pnpm/setup`](https://github.com/pnpm/setup), which installs pnpm 11 or newer only and reads the version from the consumer's `devEngines.packageManager` or `packageManager` field. A repo pinned below that cannot run them. `release` does not require pnpm 11 or newer: Its consumer path installs release-kit from npm and never invokes pnpm.

`create-github-release` and `publish` additionally require `@williamthorsen/release-kit` as a root dependency. They invoke it through `pnpm exec`, which resolves from the repository root's `node_modules/.bin`, so declaring it in a workspace package alone does not satisfy this.

## Runner selection

`audit`, `create-github-release`, `release`, and `sync-labels` run every job on the runner named by the calling repo's `CI_RUNS_ON` configuration variable, set on the repository or its organization. A called workflow reads the caller's variables, so a repo opts in without editing its caller workflow. The value is JSON: a single label or an array of labels.

```bash
gh variable set CI_RUNS_ON --body '"self-hosted"' --repo owner/repo
gh variable set CI_RUNS_ON --body '["self-hosted", "linux"]' --repo owner/repo
```

When the variable is unset or empty, the jobs run on `ubuntu-latest`. `publish` ignores the variable and always runs on `ubuntu-latest`, because npm generates provenance only on GitHub-hosted runners.

A self-hosted runner must provide the tools that the workflows take from the GitHub-hosted image: `git`, `gh`, `jq` (`audit`), and `yq` (`sync-labels`).

Set the variable only in a private repo. `audit` runs on `pull_request`, so a self-hosted runner serving a public repo runs code from any fork's pull request. This repo is public and never sets it.

## Versioning

Two kinds of tags live in this repo, and they are deliberately shaped differently:

- **Package release tags:** Unprefixed, full semver (e.g., `release-kit-v5.2.0`). Immutable; each tag marks the exact commit of a published package version.
- **Reusable-workflow pointer tags:** Namespaced under `workflow/` with a major-only version (e.g., `workflow/audit-v1`). Mutable; they move to the latest compatible commit so that external consumers can pin with `@workflow/audit-v1`.

External consumers reference reusable workflows by pointer tag:

```yaml
uses: williamthorsen/node-monorepo-tools/.github/workflows/audit.reusable.yaml@workflow/audit-v1
```

This repo's own callers use that same external ref rather than a relative path, so every workflow here is dogfooded through the exact path that a consumer takes. Two consequences follow. A pull request never exercises an edit to a `*.reusable.yaml`, because the caller resolves the pointer tag's commit instead of the branch's. And the edit does not take effect anywhere, this repo included, until the pointer tag moves to it.

### Publish trigger contract

The Publish caller (`publish.yaml`) triggers only on full-semver tags:

```yaml
on:
  push:
    tags:
      - '*-v[0-9]*.[0-9]*.[0-9]*'
```

This pattern matches package release tags but deliberately excludes any major-only or major.minor pointer tag, present or future. Pointer tags under `workflow/` are additionally excluded because GitHub Actions tag globs do not match `/`.

### Rationale for the asymmetry

Package release tags need to be easy to discover and read in tooling (e.g., in release notes, `git describe`, or downstream tag listings), so they stay unprefixed. Pointer tags live under a dedicated `workflow/` namespace because they are a different object with different semantics (mutable, major-only, aimed at external workflow consumers). The slash both documents the distinction and provides a useful glob boundary that keeps pointer tags out of any `*-v...` trigger.

### Deprecated pointer tags

The earlier pointer tags (`audit-workflow-v1`, `release-workflow-v1`, `sync-labels-workflow-v1`) are **frozen and deprecated**. They remain at their original commits so that downstream repos scaffolded before the templates migrated keep working. New updates happen only on the `workflow/{name}-v{major}` tags.

Removal was gated on two conditions. The first is satisfied: `release-kit-v10.3.2` includes `init` and `sync-labels` templates that emit only the `workflow/{name}-v{major}` refs. The second still stands, so removal waits on downstream repos having had a release cycle to adopt that version.
