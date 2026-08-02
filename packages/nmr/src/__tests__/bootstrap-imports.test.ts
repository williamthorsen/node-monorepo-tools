import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/** The bin nmr-core's `prepare` runs, under tsx, to build nmr-core before nmr-core's `dist` exists. */
const BOOTSTRAP_ENTRY = path.resolve(import.meta.dirname, '..', 'cli-build.ts');

/** The package the bootstrap cannot reach, because the bootstrap is what produces it. Subpaths included. */
const UNREACHABLE_PACKAGE = '@williamthorsen/nmr-core';

/** Matches the specifier of any static or dynamic import, or of a re-export. */
const SPECIFIER_PATTERN = /(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;

describe('the build bootstrap', () => {
  it('reaches nothing that resolves through the package it exists to build', () => {
    // A fresh clone runs `pnpm install`, whose nmr-core `prepare` builds nmr-core by running this bin from
    // source. Anything in its import graph that resolves through `@williamthorsen/nmr-core` resolves to a
    // `dist` that does not exist yet, and the install fails before a single package is built. Nothing else in
    // the suite catches it, because every other test runs against a repository that is already built.
    const offenders = collectClosure(BOOTSTRAP_ENTRY).filter((file) =>
      readSpecifiers(file).some(
        (specifier) => specifier === UNREACHABLE_PACKAGE || specifier.startsWith(`${UNREACHABLE_PACKAGE}/`),
      ),
    );

    expect(offenders.map((file) => path.relative(path.resolve(import.meta.dirname, '..'), file))).toStrictEqual([]);
  });

  it('walks a closure wide enough for the guard to mean something', () => {
    // A traversal that silently found nothing would let the guard above pass over an empty set forever.
    const closure = collectClosure(BOOTSTRAP_ENTRY).map((file) => path.basename(file));

    expect(closure).toContain('cli-build.ts');
    expect(closure).toContain('build.ts');
    expect(closure).toContain('config.ts');
  });
});

// region | Helpers

/** Returns every module reachable from `entry` through relative specifiers, `entry` included. */
function collectClosure(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file) || !existsSync(file)) {
      continue;
    }
    seen.add(file);

    for (const specifier of readSpecifiers(file)) {
      if (specifier.startsWith('.')) {
        queue.push(path.resolve(path.dirname(file), specifier));
      }
    }
  }

  return [...seen];
}

/** Returns the specifiers a module imports or re-exports. */
function readSpecifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8');

  return [...source.matchAll(SPECIFIER_PATTERN)].map((match) => match[1] ?? '');
}

// endregion | Helpers
