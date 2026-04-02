# Workflows

## Naming convention

- **Caller workflows:** `{name}.yaml` -- repo-specific workflows that trigger on events (e.g., `workflow_dispatch`) and delegate to a reusable workflow.
- **Reusable workflows:** `{name}.reusable.yaml` -- shared workflows invoked via `workflow_call`. These can be consumed by this repo (via relative path) or by other repos (via full reference).

## Versioning

Each reusable workflow is versioned independently using a workflow-prefixed tag: `{name}-workflow-v{major}`.

For example, `release.reusable.yaml` is tagged as `release-workflow-v1`. A breaking change would produce `release-workflow-v2`.

This repo references its own reusable workflows via relative path (`./.github/workflows/release.reusable.yaml`), so it is not affected by tag changes. External consumers reference by tag:

```yaml
uses: williamthorsen/node-monorepo-tools/.github/workflows/release.reusable.yaml@release-workflow-v1
```
