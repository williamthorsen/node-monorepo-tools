import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readGitFacts } from '../readGitFacts.ts';

const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:child_process'), () => ({ execFileSync: mockExecFileSync }));

/** Output of each git command for a clean checkout on `main`, keyed by its first argument. */
const CLEAN_OUTPUT: Readonly<Record<string, string>> = {
  log: ['a59f2f8c0ffee', 'Add the collector', 'Ada Lovelace', '2026-10-08T06:29:00+00:00'].join('\0') + '\n',
  'rev-parse': 'main\n',
  status: '',
  remote: 'git@github.com:acme/app.git\n',
};

describe(readGitFacts, () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it('reports every fact of a clean checkout', () => {
    respondWith(CLEAN_OUTPUT);

    expect(readGitFacts('/repo')).toStrictEqual({
      sha: 'a59f2f8c0ffee',
      message: 'Add the collector',
      author: 'Ada Lovelace',
      time: '2026-10-08T06:29:00+00:00',
      ref: 'main',
      dirty: false,
      remoteUrl: 'git@github.com:acme/app.git',
    });
  });

  it('reports a checkout with a modified tracked file as dirty', () => {
    respondWith({ ...CLEAN_OUTPUT, status: ' M src/index.ts\n' });

    expect(readGitFacts('/repo').dirty).toBe(true);
  });

  it('omits the ref of a detached HEAD', () => {
    respondWith({ ...CLEAN_OUTPUT, 'rev-parse': 'HEAD\n' });

    expect(readGitFacts('/repo')).not.toHaveProperty('ref');
  });

  it('returns no facts when the git binary is absent', () => {
    mockExecFileSync.mockImplementation(() => {
      throw Object.assign(new Error('spawnSync git ENOENT'), { code: 'ENOENT' });
    });

    expect(readGitFacts('/repo')).toStrictEqual({});
  });

  it('omits only the facts of a command that exits non-zero', () => {
    respondWith({ ...CLEAN_OUTPUT, remote: undefined });

    const facts = readGitFacts('/repo');

    expect(facts).not.toHaveProperty('remoteUrl');
    expect(facts.sha).toBe('a59f2f8c0ffee');
  });

  it('runs git in the given directory', () => {
    respondWith(CLEAN_OUTPUT);

    readGitFacts('/repo');

    expect(mockExecFileSync).toHaveBeenCalledWith('git', expect.any(Array), expect.objectContaining({ cwd: '/repo' }));
  });
});

// region | Helpers

/** Answers each git command from `output` by its first argument, failing as a non-zero exit when it is absent. */
function respondWith(output: Readonly<Record<string, string | undefined>>): void {
  mockExecFileSync.mockImplementation((_file: unknown, args: unknown) => {
    const command: unknown = Array.isArray(args) ? args[0] : undefined;
    const response = typeof command === 'string' ? output[command] : undefined;
    if (response === undefined) {
      throw new Error('Command failed with exit code 128');
    }
    return response;
  });
}

// endregion | Helpers
