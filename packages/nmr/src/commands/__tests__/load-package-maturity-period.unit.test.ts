import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { loadPackageMaturityPeriod } from '../load-package-maturity-period.ts';

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-taze-config-' })),
);

describe(loadPackageMaturityPeriod, () => {
  it('reads the default export of a taze.config.ts', async ({ tree }) => {
    tree.write(
      'taze.config.ts',
      "const days: number = 1;\nexport default { packageMaturityPeriod: { '@williamthorsen/*': days } };\n",
    );

    await expect(loadPackageMaturityPeriod(tree.dir)).resolves.toStrictEqual({ '@williamthorsen/*': 1 });
  });

  it('finds the config in an ancestor of the directory', async ({ tree }) => {
    tree.write('taze.config.mjs', 'export default { packageMaturityPeriod: { a: 2 } };\n');
    const workspace = tree.mkdir('packages/a');

    await expect(loadPackageMaturityPeriod(workspace)).resolves.toStrictEqual({ a: 2 });
  });

  it('reads a .tazerc.json', async ({ tree }) => {
    tree.writeJson('.tazerc.json', { packageMaturityPeriod: { a: 3 } });

    await expect(loadPackageMaturityPeriod(tree.dir)).resolves.toStrictEqual({ a: 3 });
  });

  it('returns undefined when the config does not declare the key', async ({ tree }) => {
    tree.write('taze.config.mjs', "export default { mode: 'minor' };\n");

    await expect(loadPackageMaturityPeriod(tree.dir)).resolves.toBeUndefined();
  });

  it('returns undefined when no config file is found', async ({ tree }) => {
    await expect(loadPackageMaturityPeriod(tree.dir)).resolves.toBeUndefined();
  });

  it('rejects when the config fails to load', async ({ tree }) => {
    tree.write('taze.config.mjs', "throw new Error('broken config');\n");

    await expect(loadPackageMaturityPeriod(tree.dir)).rejects.toThrow('broken config');
  });
});
