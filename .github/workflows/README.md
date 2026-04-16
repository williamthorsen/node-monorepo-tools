# Workflows

## Naming convention

- **Caller workflows:** `{name}.yaml` — repo-specific workflows that trigger on events (e.g., `workflow_dispatch`) and delegate to a reusable workflow.
- **Reusable workflows:** `{name}.reusable.yaml` — shared workflows invoked via `workflow_call`. These can be consumed by this repo (via relative path) or by other repos (via full reference).

## Versioning

Two kinds of tags live in this repo, and they are deliberately shaped differently:

- **Package release tags** — unprefixed, full semver (e.g., `audit-deps-v0.3.0`). Immutable; each tag marks the exact commit of a published package version.
- **Reusable-workflow pointer tags** — namespaced under `workflow/` with a major-only version (e.g., `workflow/audit-v1`). Mutable; they move to the latest compatible commit so external consumers can pin with `@workflow/audit-v1`.

External consumers reference reusable workflows by pointer tag:

```yaml
uses: williamthorsen/node-monorepo-tools/.github/workflows/audit.reusable.yaml@workflow/audit-v1
```

This repo references its own reusable workflows by relative path (`./.github/workflows/{name}.reusable.yaml`), so callers inside this repo are not affected by pointer-tag updates. The exception is workflows we dogfood through the external ref (e.g., `sync-labels.yaml`), which exercise the same path consumers use.

### Publish trigger contract

The Publish caller (`publish.yaml`) triggers only on full-semver tags:

```yaml
on:
  push:
    tags:
      - '*-v[0-9]*.[0-9]*.[0-9]*'
```

This pattern matches package release tags but deliberately excludes any major-only or major.minor pointer tag — present or future. Pointer tags under `workflow/` are additionally excluded because GitHub Actions tag globs do not match `/`.

### Rationale for the asymmetry

Package release tags need to be easy to discover and read in tooling (e.g., in release notes, `git describe`, or downstream tag listings), so they stay unprefixed. Pointer tags are a different object with different semantics (mutable, major-only, aimed at external workflow consumers), so they live under a dedicated `workflow/` namespace. The slash both documents the distinction and provides a useful glob boundary that keeps pointer tags out of any `*-v...` trigger.

### Deprecated pointer tags

The earlier pointer tags — `audit-workflow-v1`, `release-workflow-v1`, `sync-labels-workflow-v1` — are **frozen and deprecated**. They remain at their original commits so downstream repos using the `release-kit` templates (which still emit these refs) keep working. New updates happen only on the `workflow/{name}-v{major}` tags.

These old tags will be removed after:

1. `release-kit` ships a release whose `init` and `sync-labels` templates emit the new `workflow/{name}-v{major}` refs, and
2. downstream repos have had a release cycle to adopt that release-kit version.
