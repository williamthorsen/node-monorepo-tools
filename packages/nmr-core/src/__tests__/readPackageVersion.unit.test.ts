import fs from 'node:fs';
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
    fs.writeFileSync(path.join(tree.dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.2.3' }));
    const calleeFile = path.join(tree.dir, 'src', 'callee.ts');
    fs.mkdirSync(path.dirname(calleeFile), { recursive: true });

    expect(readPackageVersion(pathToFileURL(calleeFile).href)).toBe('1.2.3');
  });

  it('walks up multiple directory levels to find package.json', ({ tree }) => {
    fs.writeFileSync(path.join(tree.dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '4.5.6' }));
    const deepFile = path.join(tree.dir, 'a', 'b', 'c', 'd', 'callee.ts');
    fs.mkdirSync(path.dirname(deepFile), { recursive: true });

    expect(readPackageVersion(pathToFileURL(deepFile).href)).toBe('4.5.6');
  });

  it('throws when the located package.json has no version field', ({ tree }) => {
    fs.writeFileSync(path.join(tree.dir, 'package.json'), JSON.stringify({ name: 'fixture' }));
    const calleeFile = path.join(tree.dir, 'callee.ts');

    expect(() => readPackageVersion(pathToFileURL(calleeFile).href)).toThrow(
      /No string "version" field in .*package\.json/,
    );
  });

  it('throws when the located package.json has a non-string version field', ({ tree }) => {
    fs.writeFileSync(path.join(tree.dir, 'package.json'), JSON.stringify({ name: 'fixture', version: 42 }));
    const calleeFile = path.join(tree.dir, 'callee.ts');

    expect(() => readPackageVersion(pathToFileURL(calleeFile).href)).toThrow(
      /No string "version" field in .*package\.json/,
    );
  });

  it('includes the resolved package.json path in the error message', ({ tree }) => {
    fs.writeFileSync(path.join(tree.dir, 'package.json'), JSON.stringify({ name: 'fixture' }));
    const calleeFile = path.join(tree.dir, 'callee.ts');
    const expectedPath = path.join(tree.dir, 'package.json');

    expect(() => readPackageVersion(pathToFileURL(calleeFile).href)).toThrow(expectedPath);
  });
});
