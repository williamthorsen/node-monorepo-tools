import { UserError } from '@williamthorsen/nmr-core';
import { isError } from '@williamthorsen/toolbelt.errors';
import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { assert, describe, expect, it as baseIt } from 'vitest';

import { importConfigDefault } from '../importConfigDefault.ts';

// Each test gets its own tree because Node caches a module by URL.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-import-config-' })),
);

const UNTERMINATED_CONFIG = `const unused = 1;\nexport default { delegate: false\n`;

describe(importConfigDefault, () => {
  it('returns the default export of a config that loads', async ({ tree }) => {
    const configPath = writeConfig(tree, `export default { delegate: false };`);

    await expect(importConfigDefault(configPath)).resolves.toStrictEqual({ delegate: false });
  });

  it('returns undefined for a module without a default export', async ({ tree }) => {
    const configPath = writeConfig(tree, `export const delegate = false;`);

    await expect(importConfigDefault(configPath)).resolves.toBeUndefined();
  });

  // Vitest routes `import()` through its own transform, so the parse error and its line come from that transform;
  // `importConfigDefault.tool.test.ts` observes Node's own.
  it('reports a config that fails to parse as a UserError that names the file and keeps the cause', async ({
    tree,
  }) => {
    const configPath = writeConfig(tree, UNTERMINATED_CONFIG);

    const error = await captureRejection(importConfigDefault(configPath));

    expect(error).toBeInstanceOf(UserError);
    assert(isError(error) && isError(error.cause));
    expect(error.message).toBe(
      `Cannot load nmr config at ${configPath}: ${error.cause.message}. Fix the file and rerun.`,
    );
  });

  it('reports a config that throws as a UserError that names the file and keeps the cause', async ({ tree }) => {
    const configPath = writeConfig(tree, `throw new Error('boom');`);

    const error = await captureRejection(importConfigDefault(configPath));

    expect(error).toBeInstanceOf(UserError);
    expect(error).toMatchObject({
      cause: new Error('boom'),
      message: `Cannot load nmr config at ${configPath}: boom. Fix the file and rerun.`,
    });
  });
});

// region | Helpers

/** Returns the value with which `promise` rejects, or the value with which it resolves. */
async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    return await promise;
  } catch (error) {
    return error;
  }
}

/** Writes a config into the tree and returns its path. */
function writeConfig(tree: TempTree, source: string): string {
  tree.write('config.ts', source);
  return tree.resolve('config.ts');
}

// endregion | Helpers
