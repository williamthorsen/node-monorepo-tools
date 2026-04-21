import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

import { getCommitsSinceTarget } from '../getCommitsSinceTarget.ts';

/** Find the `git log` call args from the mock call history. */
function findLogCallArgs(): readonly unknown[] {
  for (const call of mockExecFileSync.mock.calls) {
    if (call[0] === 'git' && Array.isArray(call[1]) && call[1][0] === 'log') {
      return call[1];
    }
  }
  throw new Error('No git log call found in mock history');
}

/** Find the `git describe` call args from the mock call history. */
function findDescribeCallArgs(): readonly unknown[] {
  for (const call of mockExecFileSync.mock.calls) {
    if (call[0] === 'git' && Array.isArray(call[1]) && call[1][0] === 'describe') {
      return call[1];
    }
  }
  throw new Error('No git describe call found in mock history');
}

/** Configure the mock so that `git describe` returns the given tag and `git log` returns empty output. */
function setupDescribeMock(tag: string): void {
  mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
    if (cmd === 'git' && args[0] === 'describe') return `${tag}\n`;
    return '';
  });
}

describe(getCommitsSinceTarget, () => {
  afterEach(() => {
    mockExecFileSync.mockReset();
  });

  it('does not append -- when called without paths', () => {
    setupDescribeMock('v1.0.0');

    getCommitsSinceTarget(['v']);

    expect(findLogCallArgs()).not.toContain('--');
  });

  it('does not append -- when called with an empty paths array', () => {
    setupDescribeMock('v1.0.0');

    getCommitsSinceTarget(['v'], []);

    expect(findLogCallArgs()).not.toContain('--');
  });

  it('appends -- and the path when called with a single path', () => {
    setupDescribeMock('arrays-v1.0.0');

    getCommitsSinceTarget(['arrays-v'], ['packages/arrays/**']);

    const logArgs = findLogCallArgs();
    const separatorIndex = logArgs.indexOf('--');
    expect(separatorIndex).toBeGreaterThan(0);
    expect(logArgs.slice(separatorIndex)).toStrictEqual(['--', 'packages/arrays/**']);
  });

  it('appends all paths after -- when called with multiple paths', () => {
    setupDescribeMock('lib-v2.0.0');

    getCommitsSinceTarget(['lib-v'], ['packages/arrays/**', 'packages/strings/**']);

    const logArgs = findLogCallArgs();
    const separatorIndex = logArgs.indexOf('--');
    expect(separatorIndex).toBeGreaterThan(0);
    expect(logArgs.slice(separatorIndex)).toStrictEqual(['--', 'packages/arrays/**', 'packages/strings/**']);
  });

  it('returns the tag and parsed commits when paths is undefined', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'v1.0.0\n';
      }
      return 'feat: add featureabc123';
    });

    const result = getCommitsSinceTarget(['v']);

    expect(result.tag).toBe('v1.0.0');
    expect(result.commits).toStrictEqual([{ message: 'feat: add feature', hash: 'abc123' }]);
  });

  it('filters out release commits from the result', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'v1.0.0\n';
      }
      return ['feat: add featureabc123', 'release: arrays-v1.1.0 strings-v2.0.1def456', 'fix: patch bugghi789'].join(
        '\n',
      );
    });

    const result = getCommitsSinceTarget(['v']);

    expect(result.commits).toStrictEqual([
      { message: 'feat: add feature', hash: 'abc123' },
      { message: 'fix: patch bug', hash: 'ghi789' },
    ]);
  });

  it('returns empty commits when all commits are release commits', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'v1.0.0\n';
      }
      return 'release: v1.0.1abc123';
    });

    const result = getCommitsSinceTarget(['v']);

    expect(result.commits).toStrictEqual([]);
  });

  it('returns all commits when no matching tag exists', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        const error = Object.assign(new Error('No tag found'), { status: 128 });
        throw error;
      }
      return 'fix: patchdef456';
    });

    const result = getCommitsSinceTarget(['v']);

    expect(result.tag).toBeUndefined();
    expect(result.commits).toStrictEqual([{ message: 'fix: patch', hash: 'def456' }]);

    // Verify git log uses 'HEAD' (not 'undefined..HEAD') when no tag exists
    const logArgs = findLogCallArgs();
    expect(logArgs[1]).toBe('HEAD');
  });

  it('propagates git describe errors with a non-128 status', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        throw Object.assign(new Error('permission denied'), { status: 1 });
      }
      return '';
    });

    expect(() => getCommitsSinceTarget(['v'])).toThrow("Failed to run 'git describe': permission denied");
  });

  it('wraps and re-throws git log failures', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        throw new Error('spawn git ENOENT');
      }
      return '';
    });

    expect(() => getCommitsSinceTarget(['v'])).toThrow(
      "Failed to run 'git log' for range 'v1.0.0..HEAD': spawn git ENOENT",
    );
  });

  describe('multiple tag prefixes', () => {
    it('passes one --match flag per prefix to git describe', () => {
      setupDescribeMock('core-v0.2.7');

      getCommitsSinceTarget(['node-monorepo-core-v', 'core-v']);

      expect(findDescribeCallArgs()).toStrictEqual([
        'describe',
        '--tags',
        '--abbrev=0',
        '--match=node-monorepo-core-v*',
        '--match=core-v*',
      ]);
    });

    it('returns the tag produced by git describe when a legacy-only prefix matches', () => {
      // Only the legacy prefix has tags; git describe picks the ancestor under that prefix.
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') return 'core-v0.2.7\n';
        return 'feat: addabc123';
      });

      const result = getCommitsSinceTarget(['node-monorepo-core-v', 'core-v']);

      expect(result.tag).toBe('core-v0.2.7');
      expect(result.commits).toStrictEqual([{ message: 'feat: add', hash: 'abc123' }]);
    });

    it('returns undefined tag when no prefix in the union matches any reachable tag', () => {
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') {
          throw Object.assign(new Error('No tag found'), { status: 128 });
        }
        return '';
      });

      const result = getCommitsSinceTarget(['new-v', 'old-v']);

      expect(result.tag).toBeUndefined();
      expect(result.commits).toStrictEqual([]);
    });

    it('throws when the prefix array is empty', () => {
      expect(() => getCommitsSinceTarget([])).toThrow('findLatestTag: tagPrefixes must contain at least one entry');
    });
  });
});
