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

    getCommitsSinceTarget('v');

    expect(findLogCallArgs()).not.toContain('--');
  });

  it('does not append -- when called with an empty paths array', () => {
    setupDescribeMock('v1.0.0');

    getCommitsSinceTarget('v', []);

    expect(findLogCallArgs()).not.toContain('--');
  });

  it('appends -- and the path when called with a single path', () => {
    setupDescribeMock('arrays-v1.0.0');

    getCommitsSinceTarget('arrays-v', ['packages/arrays/**']);

    const logArgs = findLogCallArgs();
    const separatorIndex = logArgs.indexOf('--');
    expect(separatorIndex).toBeGreaterThan(0);
    expect(logArgs.slice(separatorIndex)).toStrictEqual(['--', 'packages/arrays/**']);
  });

  it('appends all paths after -- when called with multiple paths', () => {
    setupDescribeMock('lib-v2.0.0');

    getCommitsSinceTarget('lib-v', ['packages/arrays/**', 'packages/strings/**']);

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
      return 'feat: add feature\u001Fabc123';
    });

    const result = getCommitsSinceTarget('v');

    expect(result.tag).toBe('v1.0.0');
    expect(result.commits).toStrictEqual([{ message: 'feat: add feature', hash: 'abc123' }]);
  });

  it('filters out release commits from the result', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'v1.0.0\n';
      }
      return [
        'feat: add feature\u001Fabc123',
        'release: arrays-v1.1.0 strings-v2.0.1\u001Fdef456',
        'fix: patch bug\u001Fghi789',
      ].join('\n');
    });

    const result = getCommitsSinceTarget('v');

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
      return 'release: v1.0.1\u001Fabc123';
    });

    const result = getCommitsSinceTarget('v');

    expect(result.commits).toStrictEqual([]);
  });

  it('returns all commits when no matching tag exists', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        const error = Object.assign(new Error('No tag found'), { status: 128 });
        throw error;
      }
      return 'fix: patch\u001Fdef456';
    });

    const result = getCommitsSinceTarget('v');

    expect(result.tag).toBeUndefined();
    expect(result.commits).toStrictEqual([{ message: 'fix: patch', hash: 'def456' }]);

    // Verify git log uses 'HEAD' (not 'undefined..HEAD') when no tag exists
    const logArgs = findLogCallArgs();
    expect(logArgs[1]).toBe('HEAD');
  });
});
