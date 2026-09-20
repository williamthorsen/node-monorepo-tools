# Workspace introspection

The pnpm-workspace lookups that `@williamthorsen/nmr/workspace` publishes. The resolution itself lives in
`@williamthorsen/nmr-core/workspace`, which release-kit reads too; nmr re-exports the total primitives and adds
two projections that throw, so a CLI caller keeps nmr's error boundary.

`findMonorepoRoot(startDir?)` walks up from `startDir`, defaulting to `process.cwd()`, until it reaches a directory containing `pnpm-workspace.yaml`. It throws if it runs out of parent directories without finding one.

`getWorkspacePackageDirs(monorepoRoot)` reads the workspace patterns from that repo's `pnpm-workspace.yaml` and resolves them to absolute package directories, sorted and free of duplicates. It throws if `monorepoRoot` holds no `pnpm-workspace.yaml`. Patterns carry pnpm's own semantics: `packages/*`, deeper globs such as `packages/**`, exact paths such as `tools/cli`, and `!`-prefixed exclusions such as `!packages/legacy` or `!**/test/**`, which filter every directory the positive patterns matched regardless of where they appear in the list. Nothing under `node_modules` is ever returned.

One divergence from pnpm: a directory counts as a package only if it holds a `package.json`, not a `package.yaml` or `package.json5`.

`resolveWorkspace(monorepoRoot)` is the primitive both projections read, and the one a caller reaches for when an empty workspace is not a failure. It throws nothing, returning a discriminated result instead:

| `kind`            | What it carries                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `not-a-workspace` | Nothing. The directory holds no `pnpm-workspace.yaml`, so it declares no workspace at all.                   |
| `packages`        | `packageDirs`, the resolved absolute directories, and `patterns`, the `packages` list the manifest declares. |
| `empty`           | `cause`, which of four conditions emptied the resolution, and the same `patterns`.                           |

| `cause`               | What left the workspace empty                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-pattern`          | No positive pattern reaches the matcher: the `packages` key is absent, empty, not a list, not a list of strings, or holds only `!` entries. |
| `no-package`          | The patterns reach the matcher and match no directory holding a `package.json`, which is the divergence above.                              |
| `all-excluded`        | The `!` entries exclude every directory matched by the positive patterns.                                                                   |
| `unreadable-manifest` | The manifest holds no valid YAML, so nothing it declares reaches the matcher. `patterns` is empty, and no other cause is decided.           |

One remedy answers every shape of `no-pattern`, so they are not told apart. A manifest the parser rejects is held apart from them, because that remedy repairs nothing for a reader whose manifest declares a pattern above a syntax error. `all-excluded` is decided by matching the positive patterns a second time without the exclusion set, which reaches the filesystem only on this path, and only where the first resolution came back empty.

`isMonorepoRoot(dir)`, `readWorkspaceOverrides(monorepoRoot)`, and `readWorkspacePackageNames(packageDirs)` are re-exported unchanged. Each returns a value rather than throwing: `readWorkspaceOverrides` returns nothing where the manifest is missing, unreadable, unparseable, or declares no `overrides` block, and `readWorkspacePackageNames` passes over a manifest it cannot read.

Quote exclusion patterns in the manifest — `- '!packages/legacy'`. An unquoted `!` opens a YAML tag rather than a string, so the entry never reaches nmr (or pnpm) as a pattern.
