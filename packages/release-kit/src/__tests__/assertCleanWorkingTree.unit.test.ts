import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

import { assertCleanWorkingTree } from '../assertCleanWorkingTree.ts';

describe(assertCleanWorkingTree, () => {
  afterEach(() => {
    mockExecFileSync.mockReset();
  });

  it('throws when the working tree has uncommitted changes', () => {
    mockExecFileSync.mockReturnValue(' M packages/release-kit/package.json\n');

    expect(() => assertCleanWorkingTree()).toThrow(/working tree has uncommitted changes/i);
  });

  it('includes --no-git-checks hint in the error message', () => {
    mockExecFileSync.mockReturnValue(' M package.json\n');

    expect(() => assertCleanWorkingTree()).toThrow(/--no-git-checks/);
  });

  it('does not throw when the working tree is clean', () => {
    mockExecFileSync.mockReturnValue('');

    expect(() => assertCleanWorkingTree()).not.toThrow();
  });

  it('does not throw when git status returns only whitespace', () => {
    mockExecFileSync.mockReturnValue('  \n');

    expect(() => assertCleanWorkingTree()).not.toThrow();
  });

  it('calls git status with --porcelain', () => {
    mockExecFileSync.mockReturnValue('');

    assertCleanWorkingTree();

    expect(mockExecFileSync).toHaveBeenCalledWith('git', ['status', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  });
});
