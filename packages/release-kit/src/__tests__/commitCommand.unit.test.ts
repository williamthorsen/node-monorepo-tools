import { GIT_OUTPUT_LIMIT } from '@williamthorsen/nmr-core';
import { type CapturedStdio, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  readFileSync: mockReadFileSync,
}));

vi.mock(import('node:child_process'), () => ({
  execFileSync: mockExecFileSync,
}));

import { commitCommand } from '../commitCommand.ts';

/** Create an Error with a `code` property, matching Node's ErrnoException shape. */
function errnoError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Sentinel error thrown by the mocked process.exit. */
class ExitError extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

describe(commitCommand, () => {
  let capture: CapturedStdio;

  beforeEach(() => {
    capture = captureStdio();
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitError(typeof code === 'number' ? code : undefined);
    });
    silenceConsole(['info']);
  });

  afterEach(() => {
    capture[Symbol.dispose]();
    mockReadFileSync.mockReset();
    mockExecFileSync.mockReset();
    vi.restoreAllMocks();
  });

  it('creates a commit with tags and summary', () => {
    mockReadFileSync.mockImplementation((path: string) => {
      if (path === 'tmp/.release-tags') return 'release-kit-v2.4.0\ncore-v1.0.0\n';
      if (path === 'tmp/.release-summary')
        return 'release-kit-v2.4.0\n- feat: Add commit command\n\ncore-v1.0.0\n- fix: Bug';
      throw new Error('ENOENT');
    });

    commitCommand([]);

    expect(mockExecFileSync).toHaveBeenCalledWith('git', ['add', '-A'], { maxBuffer: GIT_OUTPUT_LIMIT });
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      [
        'commit',
        '-m',
        'release: release-kit-v2.4.0 core-v1.0.0\n\nrelease-kit-v2.4.0\n- feat: Add commit command\n\ncore-v1.0.0\n- fix: Bug',
      ],
      { maxBuffer: GIT_OUTPUT_LIMIT },
    );
    expect(console.info).toHaveBeenCalledWith('Created release commit: release: release-kit-v2.4.0 core-v1.0.0');
  });

  it('if the tags file is missing, throws naming the resolved path', () => {
    mockReadFileSync.mockImplementation(() => {
      throw errnoError('ENOENT: no such file or directory', 'ENOENT');
    });

    expect(() => commitCommand([])).toThrow('No tags file found at');
  });

  it('if the tags file is unreadable, reports the errno rather than reporting it missing', () => {
    mockReadFileSync.mockImplementation(() => {
      throw errnoError('EACCES: permission denied', 'EACCES');
    });

    expect(() => commitCommand([])).toThrow('Cannot read the tags file at');
  });

  it('throws when tags file is empty', () => {
    mockReadFileSync.mockImplementation((path: string) => {
      if (path === 'tmp/.release-tags') return '  \n  ';
      throw errnoError('ENOENT', 'ENOENT');
    });

    expect(() => commitCommand([])).toThrow('is empty. Run `release-kit prepare` first.');
  });

  it('falls back to empty body when summary file is missing', () => {
    mockReadFileSync.mockImplementation((path: string) => {
      if (path === 'tmp/.release-tags') return 'v1.0.0\n';
      throw errnoError('ENOENT', 'ENOENT');
    });

    commitCommand([]);

    expect(mockExecFileSync).toHaveBeenCalledWith('git', ['commit', '-m', 'release: v1.0.0'], {
      maxBuffer: GIT_OUTPUT_LIMIT,
    });
  });

  it('reports without executing in dry-run mode', () => {
    mockReadFileSync.mockImplementation((path: string) => {
      if (path === 'tmp/.release-tags') return 'v1.0.0\n';
      if (path === 'tmp/.release-summary') return 'v1.0.0\n- feat: New feature';
      throw errnoError('ENOENT', 'ENOENT');
    });
    mockExecFileSync.mockReturnValue('M package.json\n');

    commitCommand(['--dry-run']);

    expect(console.info).toHaveBeenCalledWith('[dry-run] Would create commit with message:\n');
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('release: v1.0.0'));
    expect(mockExecFileSync).toHaveBeenCalledWith('git', ['status', '--porcelain'], {
      encoding: 'utf8',
      maxBuffer: GIT_OUTPUT_LIMIT,
    });
    expect(console.info).toHaveBeenCalledWith('\nUncommitted changes:');
    // Should not call git add or git commit.
    expect(mockExecFileSync).not.toHaveBeenCalledWith('git', expect.arrayContaining(['add']));
    expect(mockExecFileSync).not.toHaveBeenCalledWith('git', expect.arrayContaining(['commit']));
  });

  it('falls back to empty body when summary file contains only whitespace', () => {
    mockReadFileSync.mockImplementation((path: string) => {
      if (path === 'tmp/.release-tags') return 'v1.0.0\n';
      if (path === 'tmp/.release-summary') return '  \n  ';
      throw errnoError('ENOENT', 'ENOENT');
    });

    commitCommand([]);

    expect(mockExecFileSync).toHaveBeenCalledWith('git', ['commit', '-m', 'release: v1.0.0'], {
      maxBuffer: GIT_OUTPUT_LIMIT,
    });
  });

  it('re-throws non-ENOENT errors when reading summary file', () => {
    mockReadFileSync.mockImplementation((path: string) => {
      if (path === 'tmp/.release-tags') return 'v1.0.0\n';
      if (path === 'tmp/.release-summary') {
        throw errnoError('EACCES: permission denied', 'EACCES');
      }
      throw new Error('ENOENT');
    });

    expect(() => commitCommand([])).toThrow('EACCES: permission denied');
  });

  it('logs a diagnostic when dry-run git status fails', () => {
    mockReadFileSync.mockImplementation((path: string) => {
      if (path === 'tmp/.release-tags') return 'v1.0.0\n';
      throw errnoError('ENOENT', 'ENOENT');
    });
    mockExecFileSync.mockImplementation(() => {
      throw new Error('git not found');
    });

    commitCommand(['--dry-run']);

    expect(console.info).toHaveBeenCalledWith('(Could not determine uncommitted changes)');
  });

  it('exits with error for unknown flags', () => {
    expect(() => commitCommand(['--unknown'])).toThrow(ExitError);
    expect(capture.stderr).toContain('Unknown option');
  });
});
