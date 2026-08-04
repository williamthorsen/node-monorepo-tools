import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  readFileSync: mockReadFileSync,
}));

import { readReleaseTags, RELEASE_SUMMARY_FILE, RELEASE_TAGS_FILE, resolveReleaseTagsPath } from '../releaseFiles.ts';

/** Create an Error with a `code` property, matching Node's ErrnoException shape. */
function errnoError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('RELEASE_TAGS_FILE', () => {
  it('is the project-root-relative path the reusable release workflow reads', () => {
    expect(RELEASE_TAGS_FILE).toBe('tmp/.release-tags');
  });
});

describe('RELEASE_SUMMARY_FILE', () => {
  it('is the project-root-relative path the commit command reads', () => {
    expect(RELEASE_SUMMARY_FILE).toBe('tmp/.release-summary');
  });
});

describe(resolveReleaseTagsPath, () => {
  it('resolves the tags file against the working directory', () => {
    expect(resolveReleaseTagsPath()).toBe(resolve('tmp/.release-tags'));
  });
});

describe(readReleaseTags, () => {
  afterEach(() => {
    mockReadFileSync.mockReset();
  });

  it('returns each non-blank line, trimmed', () => {
    mockReadFileSync.mockReturnValue('  release-kit-v2.4.0  \n\ncore-v1.0.0\n');

    expect(readReleaseTags()).toStrictEqual(['release-kit-v2.4.0', 'core-v1.0.0']);
  });

  it('returns an empty array when the file holds only whitespace', () => {
    mockReadFileSync.mockReturnValue('  \n  \n');

    expect(readReleaseTags()).toStrictEqual([]);
  });

  it('if the file is missing, names the resolved path and directs the operator to prepare', () => {
    mockReadFileSync.mockImplementation(() => {
      throw errnoError('ENOENT: no such file or directory', 'ENOENT');
    });

    expect(() => readReleaseTags()).toThrow(
      `No tags file found at ${resolve('tmp/.release-tags')}. Run \`release-kit prepare\` first.`,
    );
  });

  it('if the file is unreadable for another reason, reports the errno instead of reporting it missing', () => {
    mockReadFileSync.mockImplementation(() => {
      throw errnoError('EACCES: permission denied', 'EACCES');
    });

    expect(() => readReleaseTags()).toThrow(
      `Cannot read the tags file at ${resolve('tmp/.release-tags')}: EACCES: permission denied`,
    );
  });

  it('if the thrown value carries no errno, reports it as unreadable rather than missing', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('something else went wrong');
    });

    expect(() => readReleaseTags()).toThrow('Cannot read the tags file at');
  });

  it('preserves the underlying error as the cause', () => {
    const underlying = errnoError('EACCES: permission denied', 'EACCES');
    mockReadFileSync.mockImplementation(() => {
      throw underlying;
    });

    expect(() => readReleaseTags()).toThrow(expect.objectContaining({ cause: underlying }));
  });
});
