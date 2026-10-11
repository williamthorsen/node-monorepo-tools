import { pathToFileURL } from 'node:url';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { findPackageRoot, resolveSelfVersion } from '../packaging.ts';

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-core-packaging-' })),
);

describe('package lookups in a dual-format layout', () => {
  it('passes over the CJS marker manifest to the named package', ({ tree }) => {
    tree.writeJson('package.json', { name: 'fixture', version: '1.2.3' });
    tree.writeJson('dist/cjs/package.json', { type: 'commonjs' });
    const calleeUrl = pathToFileURL(tree.resolve('dist/cjs/callee.js')).href;

    expect(findPackageRoot(calleeUrl)).toBe(tree.dir);
    expect(resolveSelfVersion(calleeUrl)).toBe('1.2.3');
  });
});

describe(resolveSelfVersion, () => {
  it('throws when the named manifest does not declare a string version', ({ tree }) => {
    const manifestPath = tree.writeJson('package.json', { name: 'fixture' });
    const calleeUrl = pathToFileURL(tree.resolve('callee.js')).href;

    expect(() => resolveSelfVersion(calleeUrl)).toThrow(manifestPath);
  });
});
