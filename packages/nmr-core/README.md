<!-- readme-type: library -->

# @williamthorsen/nmr-core

Shared utilities for node-monorepo-tools packages.

This package serves as the shared library foundation for the monorepo. For the nmr CLI tool, see [`@williamthorsen/nmr`](../nmr).

<!-- section:release-notes --><!-- /section:release-notes -->

## Installation

Requires Node.js 24 or later.

```bash
pnpm add -D @williamthorsen/nmr-core
```

## Workspace introspection

The `./workspace` entry publishes the pnpm-workspace lookups that nmr and release-kit share. Every one of them
is total: It returns a value rather than throwing, so each CLI keeps its own error boundary.
[Workspace introspection](../nmr/docs/workspace.md) documents what each lookup returns and how it diverges
from pnpm.

The entry stays out of the root export, which keeps `yaml` out of the module closure of every other importer,
the build bootstrap's included.

## The `nmr-source` export condition

Both entries declare an `nmr-source` export condition resolving to their TypeScript source. It exists for one
caller: the compiler that builds this package. That compiler imports this package, so on a tree without build
output it has to import the source, and the condition resolves the import to that source.

Nothing else should pass `--conditions nmr-source`. Because the published package contains only `dist`, the
condition resolves to a file that is not in the tarball and fails with `ERR_MODULE_NOT_FOUND`. Resolution without
the flag is unaffected: An unmatched condition is skipped, and each entry resolves to the build output as it always
has.
