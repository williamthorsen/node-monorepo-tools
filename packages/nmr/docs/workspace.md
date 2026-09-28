# Workspace introspection

The pnpm-workspace lookups that `@williamthorsen/nmr/workspace` publishes. The resolution itself lives in
`@williamthorsen/nmr-core/workspace`, which release-kit reads too; nmr re-exports the total primitives and adds
two projections that throw, so a CLI caller keeps nmr's error boundary.

`findMonorepoRoot(startDir?)` walks up from `startDir`, defaulting to `process.cwd()`, until it reaches a directory containing `pnpm-workspace.yaml`. It throws if it runs out of parent directories without finding one.

`getWorkspacePackageDirs(monorepoRoot)` reads the workspace patterns from that repo's `pnpm-workspace.yaml` and resolves them to absolute package directories, sorted and free of duplicates. It throws if `monorepoRoot` does not contain a `pnpm-workspace.yaml`. Patterns follow pnpm's own semantics: `packages/*`, deeper globs such as `packages/**`, exact paths such as `tools/cli`, and `!`-prefixed exclusions such as `!packages/legacy` or `!**/test/**`, which filter every directory that the positive patterns matched regardless of where they appear in the list. Nothing under `node_modules` is ever returned.

One divergence from pnpm: a directory counts as a package only if it contains a `package.json`, not a `package.yaml` or `package.json5`.

`resolveWorkspace(monorepoRoot)` is the primitive that both projections read, and the one that a caller uses when an empty workspace is not a failure. It throws nothing, returning a discriminated result instead:

| `kind`            | What it contains                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `not-a-workspace` | Nothing. The directory does not contain a `pnpm-workspace.yaml`, so it does not declare a workspace at all.       |
| `packages`        | `packageDirs`, the resolved absolute directories, and `patterns`, the `packages` list that the manifest declares. |
| `empty`           | `cause`, which of four conditions emptied the resolution, and the same `patterns`.                                |

| `cause`               | What left the workspace empty                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-packages-list`    | The manifest does not declare a `packages` list: It does not contain a YAML document, lacks a `packages` key, or sets that key to null or to an empty list. `patterns` is empty. |
| `no-pattern`          | The list reaches the matcher with nothing positive, holding only `!` entries or entries that YAML left empty.                                                                    |
| `no-package`          | The patterns reach the matcher and do not match any directory containing a `package.json`, which is the divergence above.                                                        |
| `all-excluded`        | The `!` entries exclude every directory matched by the positive patterns.                                                                                                        |
| `unreadable-packages` | The `packages` value is not a list of strings, so nothing it declares reaches the matcher. `patterns` is empty.                                                                  |
| `unreadable-manifest` | Because the manifest does not contain valid YAML, nothing it declares reaches the matcher. `patterns` is empty, and the resolver does not decide any other cause.                |

Three causes separate what the manifest declares from what the reader could make of it, because one remedy does not fix all three: `no-packages-list` is a manifest asking for nothing, which pnpm resolves to the root package alone; `unreadable-packages` is a manifest asking for something the reader refused; and `no-pattern` is a list read in full whose every entry failed to become a positive pattern. A caller treating an empty resolution as a failure needs to tell the first apart from the other two. A manifest that the parser rejects outright is `unreadable-manifest`, because the pattern remedies repair nothing for a reader whose manifest declares a pattern above a syntax error. `all-excluded` is decided by matching the positive patterns a second time without the exclusion set, which reads the filesystem only on this path, and only when the first resolution came back empty.

`isMonorepoRoot(dir)`, `readWorkspaceOverrides(monorepoRoot)`, and `readWorkspacePackageNames(packageDirs)` are re-exported unchanged. Each returns a value rather than throwing: `readWorkspaceOverrides` returns nothing when the manifest is missing, unreadable, or unparseable, or does not declare an `overrides` block, and `readWorkspacePackageNames` passes over a manifest it cannot read.

Quote exclusion patterns in the manifest: `- '!packages/legacy'`. An unquoted `!` opens a YAML tag rather than a string, so the entry never reaches nmr (or pnpm) as a pattern.
