# @williamthorsen/nmr-core

Shared utilities for node-monorepo-tools packages.

This package serves as the shared library foundation for the monorepo. For the nmr CLI tool, see [`@williamthorsen/nmr`](../nmr).

<!-- section:release-notes --><!-- /section:release-notes -->

## Installation

Requires Node.js 24 or later.

```bash
pnpm add -D @williamthorsen/nmr-core
```

## The `nmr-source` export condition

Alongside the usual entry, the package declares an `nmr-source` export condition resolving to its TypeScript
source. It exists for one caller: the compiler that builds this package. That compiler imports this package, so
on a tree with no build output it has to reach the source, which is what the condition gives it.

Nothing else should pass `--conditions nmr-source`. The published package ships `dist` alone, so the condition
resolves to a file that is not in the tarball and fails with `ERR_MODULE_NOT_FOUND`. Resolution without the flag
is unaffected: an unmatched condition is skipped, and the entry resolves to the build output as it always has.
