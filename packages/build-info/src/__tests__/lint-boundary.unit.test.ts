import path from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');

/** The rules declared by the package's boundary block in `eslint.config.ts`. */
const BOUNDARY_RULES = [
  'import-x/no-nodejs-modules',
  'import-x/no-restricted-paths',
  'no-restricted-globals',
  'no-restricted-imports',
];

/**
 * A source breaking every boundary rule at once. It is linted under a path already on disk because the TypeScript
 * project service resolves the file before ESLint reaches it, and refuses a path that it cannot find.
 */
const VIOLATING_SOURCE = [
  "import { readFile } from 'node:fs/promises';",
  '',
  "import { parse } from 'yaml';",
  '',
  "import { PACKAGE_NAME } from '../../nmr-core/src/index.ts';",
  '',
  'export function probe(): unknown[] {',
  '  return [readFile, parse, PACKAGE_NAME, process.env.HOME];',
  '}',
  '',
].join('\n');

/** A source that uses Node, `process`, and a package that build-info declares, as the Node-side entries do. */
const NODE_SIDE_SOURCE = [
  "import { readFileSync } from 'node:fs';",
  '',
  "import type { Linter } from 'eslint';",
  '',
  'export function probe(): unknown[] {',
  '  const config: Linter.Config | undefined = undefined;',
  '  return [readFileSync, config, process.env.HOME];',
  '}',
  '',
].join('\n');

/** A host-agnostic source that imports the Node-side `collect` entry. */
const NODE_SIDE_IMPORT_SOURCE = [
  "import { readManifest } from './collect/sources/readManifest.ts';",
  '',
  'export const probe = readManifest;',
  '',
].join('\n');

const SOURCE_DIR = path.join(REPO_ROOT, 'packages', 'build-info', 'src');

describe('the build-info lint boundary', () => {
  it('reports each boundary rule for a source that breaks them all', { timeout: 60_000 }, async () => {
    const reported = await lintUnder(VIOLATING_SOURCE, path.join(SOURCE_DIR, 'index.ts'));

    expect(reported).toStrictEqual(BOUNDARY_RULES);
  });

  it('applies inside the package alone', { timeout: 60_000 }, async () => {
    const reported = await lintUnder(VIOLATING_SOURCE, path.join(REPO_ROOT, 'packages', 'nmr-core', 'src', 'index.ts'));

    expect(reported).toStrictEqual([]);
  });

  it('exempts the Node-side entries from the dependency rules', { timeout: 60_000 }, async () => {
    const reported = await lintUnder(NODE_SIDE_SOURCE, path.join(SOURCE_DIR, 'collect', 'sources', 'readManifest.ts'));

    expect(reported).toStrictEqual([]);
  });

  it('keeps the Node-side entries inside the package', { timeout: 60_000 }, async () => {
    const reported = await lintUnder(VIOLATING_SOURCE, path.join(SOURCE_DIR, 'collect', 'sources', 'readManifest.ts'));

    expect(reported).toStrictEqual(['import-x/no-restricted-paths']);
  });

  it('keeps the host-agnostic source from importing a Node-side entry', { timeout: 60_000 }, async () => {
    const reported = await lintUnder(NODE_SIDE_IMPORT_SOURCE, path.join(SOURCE_DIR, 'index.ts'));

    expect(reported).toStrictEqual(['import-x/no-restricted-paths']);
  });
});

// region | Helpers

/** Lints `source` as though it were the file at `filePath`, reporting which boundary rules fired. */
async function lintUnder(source: string, filePath: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const [result] = await eslint.lintText(source, { filePath });
  const fired = new Set(result?.messages.map((message) => message.ruleId));
  return BOUNDARY_RULES.filter((rule) => fired.has(rule));
}

// endregion | Helpers
