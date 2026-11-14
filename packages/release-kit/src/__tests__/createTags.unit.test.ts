import { UserError } from '@williamthorsen/nmr-core';
import { listConsoleLines, silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockUnlinkSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  readFileSync: mockReadFileSync,
  unlinkSync: mockUnlinkSync,
}));

import { createTags } from '../createTags.ts';
import { type FakeGit, makeFakeGit } from '../test-utils/fakeGit.ts';

describe(createTags, () => {
  let git: FakeGit;

  beforeEach(() => {
    git = makeFakeGit();
  });

  afterEach(() => {
    mockReadFileSync.mockReset();
    mockUnlinkSync.mockReset();
    vi.restoreAllMocks();
  });

  it('if the tags file is missing, throws naming the resolved path', () => {
    mockReadFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
    });

    expect(() => createTags({ isDryRun: false, shouldSkipGitChecks: false, style: 'rich' }, git)).toThrow(
      'No tags file found at',
    );
  });

  it('if the tags file is unreadable, reports the errno rather than reporting it missing', () => {
    mockReadFileSync.mockImplementation(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });

    expect(() => createTags({ isDryRun: false, shouldSkipGitChecks: false, style: 'rich' }, git)).toThrow(
      'Cannot read the tags file at',
    );
  });

  it('returns an empty array when the tags file is empty', () => {
    mockReadFileSync.mockReturnValue('');

    const result = createTags({ isDryRun: false, shouldSkipGitChecks: false, style: 'rich' }, git);

    expect(result).toStrictEqual([]);
    expect(git.createAnnotatedTag).not.toHaveBeenCalled();
  });

  it('returns an empty array when the tags file contains only whitespace', () => {
    mockReadFileSync.mockReturnValue('  \n  \n  ');

    const result = createTags({ isDryRun: false, shouldSkipGitChecks: false, style: 'rich' }, git);

    expect(result).toStrictEqual([]);
  });

  it('creates annotated tags for each entry in the tags file', () => {
    using _silencedConsole = silenceConsole(['info']);
    mockReadFileSync.mockReturnValue('release-kit-v2.1.0\ncore-v1.3.0\n');

    const result = createTags({ isDryRun: false, shouldSkipGitChecks: true, style: 'rich' }, git);

    expect(git.createAnnotatedTag.mock.calls).toStrictEqual([['release-kit-v2.1.0'], ['core-v1.3.0']]);
    expect(result).toStrictEqual(['release-kit-v2.1.0', 'core-v1.3.0']);
  });

  it('prints the created tags heading in normal mode', () => {
    using silent = silenceConsole(['info']);
    mockReadFileSync.mockReturnValue('v1.0.0\n');

    createTags({ isDryRun: false, shouldSkipGitChecks: true, style: 'rich' }, git);

    expect(listConsoleLines(silent.info)).toContain('Created tags:');
    expect(listConsoleLines(silent.info)).toContain('🔖 v1.0.0');
  });

  it('prints each tag with the plain marker in the plain style', () => {
    using silent = silenceConsole(['info']);
    mockReadFileSync.mockReturnValue('v1.0.0\n');

    createTags({ isDryRun: false, shouldSkipGitChecks: true, style: 'plain' }, git);
    createTags({ isDryRun: true, shouldSkipGitChecks: true, style: 'plain' }, git);

    expect(listConsoleLines(silent.info)).toStrictEqual([
      'Created tags:',
      'TAG v1.0.0',
      '[dry-run] Would create tags:',
      'TAG v1.0.0',
    ]);
  });

  it('prints the dry-run heading and does not create tags in dry-run mode', () => {
    using silent = silenceConsole(['info']);
    mockReadFileSync.mockReturnValue('v1.0.0\nv2.0.0\n');

    const result = createTags({ isDryRun: true, shouldSkipGitChecks: false, style: 'rich' }, git);

    expect(listConsoleLines(silent.info)).toContain('[dry-run] Would create tags:');
    expect(listConsoleLines(silent.info)).toContain('🔖 v1.0.0');
    expect(listConsoleLines(silent.info)).toContain('🔖 v2.0.0');
    expect(git.createAnnotatedTag).not.toHaveBeenCalled();
    expect(result).toStrictEqual(['v1.0.0', 'v2.0.0']);
  });

  it('checks for a clean working tree when not in dry-run or shouldSkipGitChecks mode', () => {
    using _silencedConsole = silenceConsole(['info']);
    mockReadFileSync.mockReturnValue('v1.0.0\n');

    createTags({ isDryRun: false, shouldSkipGitChecks: false, style: 'rich' }, git);

    expect(git.hasTrackedChanges).toHaveBeenCalledTimes(1);
  });

  it('throws when the working tree is dirty', () => {
    mockReadFileSync.mockReturnValue('v1.0.0\n');
    git.hasTrackedChanges.mockReturnValue(true);

    expect(() => createTags({ isDryRun: false, shouldSkipGitChecks: false, style: 'rich' }, git)).toThrow(
      'Working tree is dirty',
    );
    expect(git.createAnnotatedTag).not.toHaveBeenCalled();
  });

  it('skips the dirty check when shouldSkipGitChecks is true', () => {
    using _silencedConsole = silenceConsole(['info']);
    mockReadFileSync.mockReturnValue('v1.0.0\n');

    createTags({ isDryRun: false, shouldSkipGitChecks: true, style: 'rich' }, git);

    expect(git.hasTrackedChanges).not.toHaveBeenCalled();
  });

  it('skips the dirty check when isDryRun is true', () => {
    using _silencedConsole = silenceConsole(['info']);
    mockReadFileSync.mockReturnValue('v1.0.0\n');

    createTags({ isDryRun: true, shouldSkipGitChecks: false, style: 'rich' }, git);

    expect(git.hasTrackedChanges).not.toHaveBeenCalled();
  });

  it('returns the list of tag names', () => {
    using _silencedConsole = silenceConsole(['info']);
    mockReadFileSync.mockReturnValue('alpha-v1.0.0\nbeta-v2.0.0\n');

    const result = createTags({ isDryRun: false, shouldSkipGitChecks: true, style: 'rich' }, git);

    expect(result).toStrictEqual(['alpha-v1.0.0', 'beta-v2.0.0']);
  });

  it('skips the dirty-tree check when the tags file is empty', () => {
    mockReadFileSync.mockReturnValue('');
    git.hasTrackedChanges.mockReturnValue(true);

    const result = createTags({ isDryRun: false, shouldSkipGitChecks: false, style: 'rich' }, git);

    expect(result).toStrictEqual([]);
    expect(git.hasTrackedChanges).not.toHaveBeenCalled();
  });

  it('reports successfully created tags when a subsequent tag fails', () => {
    using silent = silenceConsole(['warn']);
    mockReadFileSync.mockReturnValue('tag-a\ntag-b\ntag-c\n');
    git.createAnnotatedTag.mockImplementation((tag: string) => {
      if (tag === 'tag-b') {
        throw new Error('tag already exists');
      }
    });

    expect(() => createTags({ isDryRun: false, shouldSkipGitChecks: true, style: 'rich' }, git)).toThrow(
      'tag already exists',
    );
    expect(() => createTags({ isDryRun: false, shouldSkipGitChecks: true, style: 'rich' }, git)).toThrow(UserError);

    expect(listConsoleLines(silent.warn)).toContain('Tags created before failure:');
    expect(listConsoleLines(silent.warn)).toContain('  tag-a');
  });

  it('rethrows a git failure in the clean-tree check without reporting a dirty tree', () => {
    mockReadFileSync.mockReturnValue('v1.0.0\n');
    const spawnError = Object.assign(new Error('spawn git ENOENT'), {
      errno: -2,
      code: 'ENOENT',
      syscall: 'spawn git',
    });
    git.hasTrackedChanges.mockImplementation(() => {
      throw spawnError;
    });

    expect(() => createTags({ isDryRun: false, shouldSkipGitChecks: false, style: 'rich' }, git)).toThrow(
      'spawn git ENOENT',
    );
    expect(() => createTags({ isDryRun: false, shouldSkipGitChecks: false, style: 'rich' }, git)).toThrow(UserError);
  });

  it('deletes the tags file after successful tag creation', () => {
    using _silencedConsole = silenceConsole(['info']);
    mockReadFileSync.mockReturnValue('v1.0.0\n');

    createTags({ isDryRun: false, shouldSkipGitChecks: true, style: 'rich' }, git);

    expect(mockUnlinkSync).toHaveBeenCalledWith('tmp/.release-tags');
  });

  it('deletes the summary file after successful tag creation', () => {
    using _silencedConsole = silenceConsole(['info']);
    mockReadFileSync.mockReturnValue('v1.0.0\n');

    createTags({ isDryRun: false, shouldSkipGitChecks: true, style: 'rich' }, git);

    expect(mockUnlinkSync).toHaveBeenCalledWith('tmp/.release-summary');
  });

  it('does not delete the tags file in dry-run mode', () => {
    using _silencedConsole = silenceConsole(['info']);
    mockReadFileSync.mockReturnValue('v1.0.0\n');

    createTags({ isDryRun: true, shouldSkipGitChecks: false, style: 'rich' }, git);

    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });

  it('tolerates missing tags file on deletion', () => {
    using _silencedConsole = silenceConsole(['info']);
    mockReadFileSync.mockReturnValue('v1.0.0\n');
    mockUnlinkSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    expect(() => createTags({ isDryRun: false, shouldSkipGitChecks: true, style: 'rich' }, git)).not.toThrow();
  });

  it('tolerates missing summary file on deletion', () => {
    using _silencedConsole = silenceConsole(['info']);
    mockReadFileSync.mockReturnValue('v1.0.0\n');
    let callCount = 0;
    mockUnlinkSync.mockImplementation(() => {
      callCount++;
      // First call is tags file (succeeds), second is summary file (ENOENT).
      if (callCount === 2) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
    });

    expect(() => createTags({ isDryRun: false, shouldSkipGitChecks: true, style: 'rich' }, git)).not.toThrow();
  });
});
