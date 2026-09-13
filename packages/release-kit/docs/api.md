# Programmatic API

How to build a release config by hand with `deriveWorkspaceConfig()`, the script-based approach that predates the CLI, and the workspace records that `resolveReleaseTags` takes.

## Using `deriveWorkspaceConfig()` for manual configuration

If you need to build a `MonorepoReleaseConfig` manually (e.g., for the legacy script-based approach), the exported `deriveWorkspaceConfig()` helper creates a `WorkspaceConfig` from a workspace-relative path. It reads the workspace's `package.json` to derive the tag prefix from the package name:

```typescript
import { deriveWorkspaceConfig } from '@williamthorsen/release-kit';

// packages/arrays/package.json contains `"name": "@scope/arrays"`
deriveWorkspaceConfig('packages/arrays');
// => {
//   dir: 'arrays',
//   name: '@scope/arrays',
//   tagPrefix: 'arrays-v',
//   workspacePath: 'packages/arrays',
//   packageFiles: ['packages/arrays/package.json'],
//   changelogPaths: ['packages/arrays'],
//   paths: ['packages/arrays/**'],
// }
```

`dir` is the basename of the workspace path and is the stable internal identifier used by `--only`, `WorkspaceOverride.dir`, and the dependency graph. `tagPrefix` is derived from the unscoped `package.json` `name` — any leading `@scope/` is stripped — so tags reflect the package identity rather than the directory layout. For example, a workspace at `packages/core` with `"name": "@williamthorsen/nmr-core"` produces `tagPrefix: 'nmr-core-v'`, yielding tags like `nmr-core-v1.3.0`.

The workspace's `package.json` must declare a non-empty `name` field; `deriveWorkspaceConfig()` throws otherwise. If two workspaces produce the same `tagPrefix` (because their unscoped names collide), `mergeMonorepoConfig()` throws and names the colliding workspaces so you can rename one.

## Legacy script-based approach

The CLI-driven approach is recommended for new setups. The script-based approach (using `runReleasePrepare` with a manually maintained config) is still supported for backward compatibility.

```typescript
// .github/scripts/release.config.ts
import type { MonorepoReleaseConfig } from '@williamthorsen/release-kit';
import { deriveWorkspaceConfig } from '@williamthorsen/release-kit';

export const config: MonorepoReleaseConfig = {
  workspaces: [deriveWorkspaceConfig('packages/arrays'), deriveWorkspaceConfig('packages/strings')],
  formatCommand: 'npx prettier --write',
};
```

```typescript
// .github/scripts/release-prepare.ts
import { runReleasePrepare } from '@williamthorsen/release-kit';
import { config } from './release.config.ts';

runReleasePrepare(config);
```

The key difference: the script-based approach requires manually listing every workspace, while the CLI auto-discovers them from `pnpm-workspace.yaml`.

## `resolveReleaseTags` takes workspaces; `WorkspaceConfig` requires `workspacePath`

Tag resolution is now driven by workspace records rather than a caller-supplied directory map, so `resolveReleaseTags` can report both the workspace `dir` and its `workspacePath` for every resolved tag.

- `resolveReleaseTags` signature changed from `(workspaceMap?: Map<string, string>)` to `(workspaces?: readonly WorkspaceConfig[])`.
- `WorkspaceConfig` gained a required `workspacePath: string` field.

Replace direct `Map`-based calls with `deriveWorkspaceConfig()`, which now populates `workspacePath` for you:

```diff
-import { resolveReleaseTags } from '@williamthorsen/release-kit';
-
-const workspaceMap = new Map([['core', 'packages/core']]);
-resolveReleaseTags(workspaceMap);
+import { deriveWorkspaceConfig, resolveReleaseTags } from '@williamthorsen/release-kit';
+
+resolveReleaseTags([deriveWorkspaceConfig('packages/core')]);
```

If you construct `WorkspaceConfig` objects directly, add `workspacePath` alongside the other required fields.
