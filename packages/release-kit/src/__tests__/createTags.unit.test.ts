import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
}));

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

import { createTags } from '../createTags.ts';

describe(createTags, () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    mockReadFileSync.mockReset();
    mockExecFileSync.mockReset();
    vi.restoreAllMocks();
  });

  it('throws when the tags file is missing', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    expect(() => createTags({ dryRun: false, noGitChecks: false })).toThrow(
      'No tags file found. Run `release-kit prepare` first.',
    );
  });

  it('returns an empty array when the tags file is empty', () => {
    mockReadFileSync.mockReturnValue('');

    const result = createTags({ dryRun: false, noGitChecks: false });

    expect(result).toEqual([]);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('returns an empty array when the tags file contains only whitespace', () => {
    mockReadFileSync.mockReturnValue('  \n  \n  ');

    const result = createTags({ dryRun: false, noGitChecks: false });

    expect(result).toEqual([]);
  });

  it('creates annotated tags for each entry in the tags file', () => {
    mockReadFileSync.mockReturnValue('release-kit-v2.1.0\ncore-v1.3.0\n');

    const result = createTags({ dryRun: false, noGitChecks: true });

    expect(mockExecFileSync).toHaveBeenCalledWith('git', [
      'tag',
      '-a',
      'release-kit-v2.1.0',
      '-m',
      'release-kit-v2.1.0',
    ]);
    expect(mockExecFileSync).toHaveBeenCalledWith('git', ['tag', '-a', 'core-v1.3.0', '-m', 'core-v1.3.0']);
    expect(result).toEqual(['release-kit-v2.1.0', 'core-v1.3.0']);
  });

  it('prints the created tags heading in normal mode', () => {
    mockReadFileSync.mockReturnValue('v1.0.0\n');

    createTags({ dryRun: false, noGitChecks: true });

    expect(console.info).toHaveBeenCalledWith('Created tags:');
    expect(console.info).toHaveBeenCalledWith('🏷️ v1.0.0');
  });

  it('prints the dry-run heading and does not create tags in dry-run mode', () => {
    mockReadFileSync.mockReturnValue('v1.0.0\nv2.0.0\n');

    const result = createTags({ dryRun: true, noGitChecks: false });

    expect(console.info).toHaveBeenCalledWith('[dry-run] Would create tags:');
    expect(console.info).toHaveBeenCalledWith('🏷️ v1.0.0');
    expect(console.info).toHaveBeenCalledWith('🏷️ v2.0.0');
    expect(mockExecFileSync).not.toHaveBeenCalled();
    expect(result).toEqual(['v1.0.0', 'v2.0.0']);
  });

  it('checks for a clean working tree when not in dry-run or noGitChecks mode', () => {
    mockReadFileSync.mockReturnValue('v1.0.0\n');

    createTags({ dryRun: false, noGitChecks: false });

    expect(mockExecFileSync).toHaveBeenCalledWith('git', ['diff', '--quiet']);
    expect(mockExecFileSync).toHaveBeenCalledWith('git', ['diff', '--quiet', '--cached']);
  });

  it('throws when the working tree is dirty', () => {
    mockReadFileSync.mockReturnValue('v1.0.0\n');
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'diff') {
        throw new Error('exit code 1');
      }
    });

    expect(() => createTags({ dryRun: false, noGitChecks: false })).toThrow('Working tree is dirty');
  });

  it('skips the dirty check when noGitChecks is true', () => {
    mockReadFileSync.mockReturnValue('v1.0.0\n');

    createTags({ dryRun: false, noGitChecks: true });

    // Only git tag calls, no git diff calls
    const diffCalls = mockExecFileSync.mock.calls.filter(
      (call: unknown[]) => Array.isArray(call[1]) && call[1][0] === 'diff',
    );
    expect(diffCalls).toHaveLength(0);
  });

  it('skips the dirty check when dryRun is true', () => {
    mockReadFileSync.mockReturnValue('v1.0.0\n');

    createTags({ dryRun: true, noGitChecks: false });

    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('returns the list of tag names', () => {
    mockReadFileSync.mockReturnValue('alpha-v1.0.0\nbeta-v2.0.0\n');

    const result = createTags({ dryRun: false, noGitChecks: true });

    expect(result).toEqual(['alpha-v1.0.0', 'beta-v2.0.0']);
  });
});
