import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { describe, expect, it } from 'vitest';

import { readManifest } from '../readManifest.ts';

describe(readManifest, () => {
  it('returns the name, version, and repository', () => {
    using tree = createTree({
      'package.json': JSON.stringify({ name: 'app', version: '0.7.0', repository: 'acme/app' }),
    });

    expect(readManifest(tree.dir)).toStrictEqual({ name: 'app', version: '0.7.0', repository: 'acme/app' });
  });

  it('omits an absent repository', () => {
    using tree = createTree({ 'package.json': JSON.stringify({ name: 'app', version: '0.7.0' }) });

    expect(readManifest(tree.dir)).toStrictEqual({ name: 'app', version: '0.7.0' });
  });

  it('throws when the manifest is missing', () => {
    using tree = createTree({});

    expect(() => readManifest(tree.dir)).toThrow(/package\.json/);
  });

  it.each([
    ['name', { version: '0.7.0' }],
    ['version', { name: 'app' }],
    ['version', { name: 'app', version: '' }],
  ])('throws when the %s is missing', (field, manifest) => {
    using tree = createTree({ 'package.json': JSON.stringify(manifest) });

    expect(() => readManifest(tree.dir)).toThrow(`does not declare a ${field}`);
  });

  it('throws when the manifest is not an object', () => {
    using tree = createTree({ 'package.json': '[]' });

    expect(() => readManifest(tree.dir)).toThrow('does not contain a JSON object');
  });
});

// region | Helpers

/** Creates a temporary directory holding the given files, removed when its binding is disposed. */
function createTree(entries: Record<string, string>): TempTree {
  return createTempTree(entries, { prefix: 'build-info-manifest-' });
}

// endregion | Helpers
