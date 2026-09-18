# Workspace introspection

The pnpm-workspace lookups that `@williamthorsen/nmr/workspace` publishes.

`findMonorepoRoot(startDir?)` walks up from `startDir`, defaulting to `process.cwd()`, until it reaches a directory containing `pnpm-workspace.yaml`. It throws if it runs out of parent directories without finding one.

`getWorkspacePackageDirs(monorepoRoot)` reads the workspace patterns from that repo's `pnpm-workspace.yaml` and resolves them to absolute package directories, sorted and free of duplicates. It throws if `monorepoRoot` holds no `pnpm-workspace.yaml`. Patterns carry pnpm's own semantics: `packages/*`, deeper globs such as `packages/**`, exact paths such as `tools/cli`, and `!`-prefixed exclusions such as `!packages/legacy` or `!**/test/**`, which filter every directory the positive patterns matched regardless of where they appear in the list. Nothing under `node_modules` is ever returned.

One divergence from pnpm: a directory counts as a package only if it holds a `package.json`, not a `package.yaml` or `package.json5`.

`diagnoseEmptyWorkspace(monorepoRoot)` reports why that resolution came back empty, for a caller that has one and found it so. It returns the `cause` and the `packages` list the manifest declares, and it throws where `monorepoRoot` holds no `pnpm-workspace.yaml`, as `getWorkspacePackageDirs` does.

| `cause`        | What left the workspace empty                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `no-pattern`   | No positive pattern reaches the matcher: the `packages` key is absent, empty, not a list of strings, or holds only `!` entries. |
| `no-manifest`  | The patterns reach the matcher and match no directory holding a `package.json`, which is the divergence above.                  |
| `all-excluded` | The `!` entries exclude every directory matched by the positive patterns.                                                       |

One remedy answers all four shapes of `no-pattern`, so they are not told apart. `all-excluded` is decided by matching the positive patterns a second time without the exclusion set, which reaches the filesystem only on this path.

Quote exclusion patterns in the manifest — `- '!packages/legacy'`. An unquoted `!` opens a YAML tag rather than a string, so the entry never reaches nmr (or pnpm) as a pattern.
