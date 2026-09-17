import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { findMonorepoRoot } from '@williamthorsen/nmr/workspace';
import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

const SEAM_DEPENDENCY = '@williamthorsen/toolbelt.terminal';

/** The one module that imports the dependency, and the one manifest that declares it. */
const SEAM_MODULE = 'packages/nmr-core/src/terminal.ts';
const SEAM_MANIFEST = 'packages/nmr-core/package.json';

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

/** A quoted specifier of the dependency or one of its subpaths, where an import, a `require`, or a mock names it. */
const SPECIFIER_PATTERN =
  /(?:from|import|mock|require)\s*\(?\s*["'`]@williamthorsen\/toolbelt\.terminal(?:\/[^"'`]*)?["'`]/;

const SOURCE_FILE_PATTERN = /\.[cm]?[jt]sx?$/;

const PRUNED = new Set(['.git', 'coverage', 'dist', 'node_modules']);

const monorepoRoot = findMonorepoRoot(import.meta.dirname);

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-terminal-boundary-' })),
);

/**
 * Guards the seam over the experimental `toolbelt.terminal` API: A change to that API is repaired in one
 * module only while that module is its sole importer and nmr-core its sole declarer.
 */
describe('the toolbelt.terminal boundary', () => {
  it('has the seam module as its only importer', () => {
    expect(findImporters(monorepoRoot)).toStrictEqual([SEAM_MODULE]);
  });

  it('has nmr-core as its only declarer', () => {
    expect(findDeclarers(monorepoRoot)).toStrictEqual([SEAM_MANIFEST]);
  });
});

describe(findImporters, () => {
  it.for([
    { name: 'a static import', code: `import { wrapToWidth } from '${SEAM_DEPENDENCY}/candidate';\n` },
    { name: 'a type-only import', code: `import type { OutputStyle } from "${SEAM_DEPENDENCY}/candidate";\n` },
    { name: 'a re-export', code: `export { wrapToWidth } from '${SEAM_DEPENDENCY}';\n` },
    { name: 'a dynamic import', code: `const terminal = await import('${SEAM_DEPENDENCY}/candidate');\n` },
    { name: 'a module mock', code: `vi.mock('${SEAM_DEPENDENCY}/candidate');\n` },
  ])('reports $name', ({ code }, { tree }) => {
    tree.write('packages/release-kit/src/format.ts', code);

    expect(findImporters(tree.dir)).toStrictEqual(['packages/release-kit/src/format.ts']);
  });

  it('ignores a sibling package whose name extends the dependency name', ({ tree }) => {
    tree.write('packages/nmr/src/runner.ts', `import { x } from '${SEAM_DEPENDENCY}-extras';\n`);

    expect(findImporters(tree.dir)).toStrictEqual([]);
  });

  it('ignores an installed dependency that imports it', ({ tree }) => {
    tree.write('node_modules/dep/index.js', `import { wrapToWidth } from '${SEAM_DEPENDENCY}';\n`);

    expect(findImporters(tree.dir)).toStrictEqual([]);
  });
});

describe(findDeclarers, () => {
  it.for(DEPENDENCY_FIELDS)('reports a manifest naming it under %s', (field, { tree }) => {
    tree.write('packages/release-kit/package.json', JSON.stringify({ [field]: { [SEAM_DEPENDENCY]: 'catalog:' } }));

    expect(findDeclarers(tree.dir)).toStrictEqual(['packages/release-kit/package.json']);
  });

  it('ignores a manifest that declares other dependencies', ({ tree }) => {
    tree.write(
      'packages/nmr/package.json',
      JSON.stringify({ dependencies: { [`${SEAM_DEPENDENCY}-extras`]: '1.0.0' } }),
    );

    expect(findDeclarers(tree.dir)).toStrictEqual([]);
  });
});

// region | Helpers

/** Reports whether a parsed manifest names the dependency in any of its dependency fields. */
function declaresSeamDependency(manifest: unknown): boolean {
  if (!isRecord(manifest)) return false;
  return DEPENDENCY_FIELDS.some((field) => {
    const dependencies = manifest[field];
    return isRecord(dependencies) && Object.hasOwn(dependencies, SEAM_DEPENDENCY);
  });
}

/** Lists the manifests under `rootDir` that declare the dependency, as sorted root-relative paths. */
function findDeclarers(rootDir: string): string[] {
  return listFiles(rootDir)
    .filter((file) => path.basename(file) === 'package.json')
    .filter((file) => declaresSeamDependency(JSON.parse(readFileSync(path.join(rootDir, file), 'utf8'))))
    .toSorted();
}

/** Lists the source files under `rootDir` that name the dependency in a specifier, as sorted root-relative paths. */
function findImporters(rootDir: string): string[] {
  return listFiles(rootDir)
    .filter((file) => SOURCE_FILE_PATTERN.test(file))
    .filter((file) => SPECIFIER_PATTERN.test(readFileSync(path.join(rootDir, file), 'utf8')))
    .toSorted();
}

/** Narrows a parsed JSON value to an object whose properties can be read. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Walks `rootDir`, returning every file outside the pruned directories as a root-relative POSIX path. */
function listFiles(rootDir: string, relativeDir = ''): string[] {
  return readdirSync(path.join(rootDir, relativeDir), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      return PRUNED.has(entry.name) ? [] : listFiles(rootDir, relativePath);
    }
    return entry.isFile() ? [relativePath] : [];
  });
}

// endregion | Helpers
