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

describe('the change-grammar lint boundary', () => {
  it.each([
    ['the entry point', path.join('src', 'index.ts')],
    ['a module in a role directory', path.join('src', 'record', 'tokens.ts')],
  ])(
    'reports each boundary rule for a source that breaks them all, linted as %s',
    { timeout: 60_000 },
    async (_, file) => {
      const reported = await lintUnder(path.join(REPO_ROOT, 'packages', 'change-grammar', file));

      expect(reported).toStrictEqual(BOUNDARY_RULES);
    },
  );

  it('applies inside the package alone', { timeout: 60_000 }, async () => {
    const reported = await lintUnder(path.join(REPO_ROOT, 'packages', 'nmr-core', 'src', 'index.ts'));

    expect(reported).toStrictEqual([]);
  });
});

// region | Helpers

/**
 * Builds a source breaking every boundary rule at once, its relative import resolving outside the package from
 * `filePath`. It is linted under a path already on disk because the TypeScript project service resolves the file
 * before ESLint reaches it, and refuses a path that it cannot find.
 */
function buildViolatingSource(filePath: string): string {
  const outsideModule = path.relative(
    path.dirname(filePath),
    path.join(REPO_ROOT, 'packages', 'nmr-core', 'src', 'index.ts'),
  );
  return [
    "import { readFile } from 'node:fs/promises';",
    '',
    "import { parse } from 'yaml';",
    '',
    `import { PACKAGE_NAME } from '${outsideModule}';`,
    '',
    'export function probe(): unknown[] {',
    '  return [readFile, parse, PACKAGE_NAME, process.env.HOME];',
    '}',
    '',
  ].join('\n');
}

/** Lints the violating source as though it were the file at `filePath`, reporting which boundary rules fired. */
async function lintUnder(filePath: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const [result] = await eslint.lintText(buildViolatingSource(filePath), { filePath });
  const fired = new Set(result?.messages.map((message) => message.ruleId));
  return BOUNDARY_RULES.filter((rule) => fired.has(rule));
}

// endregion | Helpers
