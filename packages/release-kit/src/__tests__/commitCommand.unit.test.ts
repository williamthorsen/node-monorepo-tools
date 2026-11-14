import { UserError } from '@williamthorsen/nmr-core';
import { type CapturedStdio, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  readFileSync: mockReadFileSync,
}));

import { commitCommand } from '../commitCommand.ts';
import { makeCommitOptions } from '../test-utils/commandOptions.ts';
import { type FakeGit, makeFakeGit } from '../test-utils/fakeGit.ts';

/** Creates an Error with a `code` property, matching Node's ErrnoException shape. */
function createErrnoError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe(commitCommand, () => {
  let stdioCapture: CapturedStdio;
  let git: FakeGit;

  beforeEach(() => {
    git = makeFakeGit();
    stdioCapture = captureStdio();
    void silenceConsole(['info']);
  });

  afterEach(() => {
    stdioCapture[Symbol.dispose]();
    mockReadFileSync.mockReset();
    vi.restoreAllMocks();
  });

  it('creates a commit with tags and summary', () => {
    mockReadFileSync.mockImplementation((path: string) => {
      if (path === 'tmp/.release-tags') return 'release-kit-v2.4.0\ncore-v1.0.0\n';
      if (path === 'tmp/.release-summary')
        return 'release-kit-v2.4.0\n- feat: Add commit command\n\ncore-v1.0.0\n- fix: Bug';
      throw new Error('ENOENT');
    });

    commitCommand(makeCommitOptions(), git);

    expect(git.addAll).toHaveBeenCalledOnce();
    expect(git.commit).toHaveBeenCalledExactlyOnceWith(
      'release: release-kit-v2.4.0 core-v1.0.0\n\nrelease-kit-v2.4.0\n- feat: Add commit command\n\ncore-v1.0.0\n- fix: Bug',
    );
    expect(git.addAll.mock.invocationCallOrder[0]).toBeLessThan(git.commit.mock.invocationCallOrder[0] ?? 0);
    expect(console.info).toHaveBeenCalledWith('Created release commit: release: release-kit-v2.4.0 core-v1.0.0');
  });

  it('if the tags file is missing, throws naming the resolved path', () => {
    mockReadFileSync.mockImplementation(() => {
      throw createErrnoError('ENOENT: no such file or directory', 'ENOENT');
    });

    expect(() => commitCommand(makeCommitOptions(), git)).toThrow(UserError);
    expect(() => commitCommand(makeCommitOptions(), git)).toThrow('No tags file found at');
  });

  it('if the tags file is unreadable, reports the errno rather than reporting it missing', () => {
    mockReadFileSync.mockImplementation(() => {
      throw createErrnoError('EACCES: permission denied', 'EACCES');
    });

    expect(() => commitCommand(makeCommitOptions(), git)).toThrow(UserError);
    expect(() => commitCommand(makeCommitOptions(), git)).toThrow('Cannot read the tags file at');
  });

  it('throws when tags file is empty', () => {
    mockReadFileSync.mockImplementation((path: string) => {
      if (path === 'tmp/.release-tags') return '  \n  ';
      throw createErrnoError('ENOENT', 'ENOENT');
    });

    expect(() => commitCommand(makeCommitOptions(), git)).toThrow(UserError);
    expect(() => commitCommand(makeCommitOptions(), git)).toThrow('is empty. Run `release-kit prepare` first.');
  });

  it('falls back to empty body when summary file is missing', () => {
    mockReadFileSync.mockImplementation((path: string) => {
      if (path === 'tmp/.release-tags') return 'v1.0.0\n';
      throw createErrnoError('ENOENT', 'ENOENT');
    });

    commitCommand(makeCommitOptions(), git);

    expect(git.commit).toHaveBeenCalledExactlyOnceWith('release: v1.0.0');
  });

  it('reports without executing in dry-run mode', () => {
    mockReadFileSync.mockImplementation((path: string) => {
      if (path === 'tmp/.release-tags') return 'v1.0.0\n';
      if (path === 'tmp/.release-summary') return 'v1.0.0\n- feat: New feature';
      throw createErrnoError('ENOENT', 'ENOENT');
    });
    git.readStatus.mockReturnValue(' M package.json');

    commitCommand(makeCommitOptions({ isDryRun: true }), git);

    expect(console.info).toHaveBeenCalledWith('[dry-run] Would create commit with message:\n');
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('release: v1.0.0'));
    expect(console.info).toHaveBeenCalledWith('\nUncommitted changes:');
    expect(console.info).toHaveBeenCalledWith(' M package.json');
    expect(git.addAll).not.toHaveBeenCalled();
    expect(git.commit).not.toHaveBeenCalled();
  });

  it('falls back to empty body when summary file contains only whitespace', () => {
    mockReadFileSync.mockImplementation((path: string) => {
      if (path === 'tmp/.release-tags') return 'v1.0.0\n';
      if (path === 'tmp/.release-summary') return '  \n  ';
      throw createErrnoError('ENOENT', 'ENOENT');
    });

    commitCommand(makeCommitOptions(), git);

    expect(git.commit).toHaveBeenCalledExactlyOnceWith('release: v1.0.0');
  });

  it('re-throws non-ENOENT errors when reading summary file', () => {
    mockReadFileSync.mockImplementation((path: string) => {
      if (path === 'tmp/.release-tags') return 'v1.0.0\n';
      if (path === 'tmp/.release-summary') {
        throw createErrnoError('EACCES: permission denied', 'EACCES');
      }
      throw new Error('ENOENT');
    });

    expect(() => commitCommand(makeCommitOptions(), git)).toThrow(UserError);
    expect(() => commitCommand(makeCommitOptions(), git)).toThrow('EACCES: permission denied');
  });

  it('logs a diagnostic when dry-run git status fails', () => {
    mockReadFileSync.mockImplementation((path: string) => {
      if (path === 'tmp/.release-tags') return 'v1.0.0\n';
      throw createErrnoError('ENOENT', 'ENOENT');
    });
    git.readStatus.mockImplementation(() => {
      throw new Error('git not found');
    });

    commitCommand(makeCommitOptions({ isDryRun: true }), git);

    expect(console.info).toHaveBeenCalledWith('(Could not determine uncommitted changes)');
  });
});
