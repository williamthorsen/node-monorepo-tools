import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { readPackageVersion } from '../readPackageVersion.ts';

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'readPackageVersion-' })),
);

describe(readPackageVersion, () => {
  it('returns the version string from the nearest ancestor package.json', ({ tree }) => {
    tree.writeJson('package.json', { name: 'fixture', version: '1.2.3' });
    tree.mkdir('src');
    const calleeFile = tree.resolve('src/callee.ts');

    expect(readPackageVersion(pathToFileURL(calleeFile).href)).toBe('1.2.3');
  });

  it('walks up multiple directory levels to find package.json', ({ tree }) => {
    tree.writeJson('package.json', { name: 'fixture', version: '4.5.6' });
    tree.mkdir('a/b/c/d');
    const deepFile = tree.resolve('a/b/c/d/callee.ts');

    expect(readPackageVersion(pathToFileURL(deepFile).href)).toBe('4.5.6');
  });

  it('throws when the located package.json has no version field', ({ tree }) => {
    tree.writeJson('package.json', { name: 'fixture' });
    const calleeFile = path.join(tree.dir, 'callee.ts');

    expect(() => readPackageVersion(pathToFileURL(calleeFile).href)).toThrow(
      /No string "version" field in .*package\.json/,
    );
  });

  it('throws when the located package.json has a non-string version field', ({ tree }) => {
    tree.writeJson('package.json', { name: 'fixture', version: 42 });
    const calleeFile = path.join(tree.dir, 'callee.ts');

    expect(() => readPackageVersion(pathToFileURL(calleeFile).href)).toThrow(
      /No string "version" field in .*package\.json/,
    );
  });

  it('includes the resolved package.json path in the error message', ({ tree }) => {
    const expectedPath = tree.writeJson('package.json', { name: 'fixture' });
    const calleeFile = path.join(tree.dir, 'callee.ts');

    expect(() => readPackageVersion(pathToFileURL(calleeFile).href)).toThrow(expectedPath);
  });
});
