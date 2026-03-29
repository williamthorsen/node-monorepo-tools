import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
}));

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

import { commitCommand } from '../commitCommand.ts';

/** Sentinel error thrown by the mocked process.exit. */
class ExitError extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

describe(commitCommand, () => {
  beforeEach(() => {
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitError(typeof code === 'number' ? code : undefined);
    });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
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

    expect(mockExecFileSync).toHaveBeenCalledWith('git', ['add', '-A']);
    expect(mockExecFileSync).toHaveBeenCalledWith('git', [
      'commit',
      '-m',
      'release: release-kit-v2.4.0 core-v1.0.0\n\nrelease-kit-v2.4.0\n- feat: Add commit command\n\ncore-v1.0.0\n- fix: Bug',
    ]);
    expect(console.info).toHaveBeenCalledWith('Created release commit: release: release-kit-v2.4.0 core-v1.0.0');
  });

  it('throws when tags file is missing', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    expect(() => commitCommand([])).toThrow('No tags file found. Run `release-kit prepare` first.');
  });

  it('throws when tags file is empty', () => {
    mockReadFileSync.mockImplementation((path: string) => {
      if (path === 'tmp/.release-tags') return '  \n  ';
      throw new Error('ENOENT');
    });

    expect(() => commitCommand([])).toThrow('Tags file is empty. Run `release-kit prepare` first.');
  });

  it('falls back to empty body when summary file is missing', () => {
    mockReadFileSync.mockImplementation((path: string) => {
      if (path === 'tmp/.release-tags') return 'v1.0.0\n';
      throw new Error('ENOENT');
    });

    commitCommand([]);

    expect(mockExecFileSync).toHaveBeenCalledWith('git', ['commit', '-m', 'release: v1.0.0']);
  });

  it('reports without executing in dry-run mode', () => {
    mockReadFileSync.mockImplementation((path: string) => {
      if (path === 'tmp/.release-tags') return 'v1.0.0\n';
      if (path === 'tmp/.release-summary') return 'v1.0.0\n- feat: New feature';
      throw new Error('ENOENT');
    });
    mockExecFileSync.mockReturnValue('M package.json\n');

    commitCommand(['--dry-run']);

    expect(console.info).toHaveBeenCalledWith('[dry-run] Would create commit with message:\n');
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('release: v1.0.0'));
    // Should not call git add or git commit.
    expect(mockExecFileSync).not.toHaveBeenCalledWith('git', expect.arrayContaining(['add']));
    expect(mockExecFileSync).not.toHaveBeenCalledWith('git', expect.arrayContaining(['commit']));
  });

  it('exits with error for unknown flags', () => {
    expect(() => commitCommand(['--unknown'])).toThrow(ExitError);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Unknown option'));
  });
});
