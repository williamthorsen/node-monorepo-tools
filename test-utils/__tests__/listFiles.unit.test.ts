import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { listFiles } from '../listFiles.ts';

const PRUNED = new Set(['dist', 'node_modules']);

const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-list-files-' })),
);

describe(listFiles, () => {
  it('lists nested files as root-relative POSIX paths', ({ tree }) => {
    tree.write('a.ts', '');
    tree.write('src/lib/b.ts', '');

    expect(listFiles(tree.dir, PRUNED).toSorted()).toStrictEqual(['a.ts', 'src/lib/b.ts']);
  });

  it('skips a pruned directory at any depth', ({ tree }) => {
    tree.write('dist/a.js', '');
    tree.write('packages/core/node_modules/dep/index.js', '');
    tree.write('packages/core/src/c.ts', '');

    expect(listFiles(tree.dir, PRUNED)).toStrictEqual(['packages/core/src/c.ts']);
  });

  it('keeps a file whose name matches a pruned name', ({ tree }) => {
    tree.write('src/dist', '');

    expect(listFiles(tree.dir, PRUNED)).toStrictEqual(['src/dist']);
  });

  it('lists only the given subtree, with paths still relative to the root', ({ tree }) => {
    tree.write('other/a.ts', '');
    tree.write('packages/nmr/src/b.ts', '');

    expect(listFiles(tree.dir, PRUNED, 'packages/nmr')).toStrictEqual(['packages/nmr/src/b.ts']);
  });
});
