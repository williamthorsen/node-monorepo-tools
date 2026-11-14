import { UserError } from '@williamthorsen/nmr-core';
import { describe, expect, it } from 'vitest';

import { assertCleanWorkingTree } from '../assertCleanWorkingTree.ts';
import { makeFakeGit } from '../test-utils/fakeGit.ts';

describe(assertCleanWorkingTree, () => {
  it('throws when the working tree has uncommitted changes', () => {
    const git = makeFakeGit({ readStatus: () => ' M packages/release-kit/package.json' });

    expect(() => assertCleanWorkingTree(git)).toThrow(UserError);
    expect(() => assertCleanWorkingTree(git)).toThrow(/working tree has uncommitted changes/i);
  });

  it('includes --no-git-checks hint in the error message', () => {
    const git = makeFakeGit({ readStatus: () => ' M package.json' });

    expect(() => assertCleanWorkingTree(git)).toThrow(/--no-git-checks/);
  });

  it('does not throw when the working tree is clean', () => {
    expect(() => assertCleanWorkingTree(makeFakeGit())).not.toThrow();
  });

  it('rethrows a git failure as a user error', () => {
    const git = makeFakeGit({
      readStatus: () => {
        throw new Error('fatal: not a git repository');
      },
    });

    expect(() => assertCleanWorkingTree(git)).toThrow(UserError);
    expect(() => assertCleanWorkingTree(git)).toThrow(/not a git repository/);
  });
});
