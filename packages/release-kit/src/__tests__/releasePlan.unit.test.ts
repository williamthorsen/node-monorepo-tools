import type { WriteResult } from '@williamthorsen/nmr-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockWriteFileWithCheck = vi.hoisted(() =>
  vi.fn<(path: string, content: string, options: { dryRun: boolean; overwrite: boolean }) => WriteResult>(),
);

vi.mock(import('@williamthorsen/nmr-core'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    writeFileWithCheck: mockWriteFileWithCheck,
  };
});

import type { ReleasePlan } from '../releasePlan.ts';
import { applyReleasePlan } from '../releasePlan.ts';

describe(applyReleasePlan, () => {
  beforeEach(() => {
    mockWriteFileWithCheck.mockImplementation((filePath: string) => ({ filePath, outcome: 'created' }));
  });

  afterEach(() => {
    mockWriteFileWithCheck.mockReset();
  });

  it('writes content files first, then the summary, then the tags file', () => {
    applyReleasePlan(makePlan());

    expect(writtenPaths()).toStrictEqual([
      'packages/core/package.json',
      'packages/core/CHANGELOG.md',
      'tmp/.release-summary',
      'tmp/.release-tags',
    ]);
  });

  it('omits the summary file when the summary is empty', () => {
    applyReleasePlan(makePlan({ summary: '' }));

    expect(writtenPaths()).not.toContain('tmp/.release-summary');
  });

  it('omits the tags file when the plan releases nothing', () => {
    applyReleasePlan(makePlan({ tags: [] }));

    expect(writtenPaths()).not.toContain('tmp/.release-tags');
  });

  it('writes one tag per line', () => {
    applyReleasePlan(makePlan({ tags: ['core-v1.0.0', 'cli-v2.1.0'] }));

    expect(mockWriteFileWithCheck).toHaveBeenCalledWith('tmp/.release-tags', 'core-v1.0.0\ncli-v2.1.0', {
      dryRun: false,
      overwrite: true,
    });
  });

  it('returns the paths written, in order', () => {
    const written = applyReleasePlan(makePlan());

    expect(written).toStrictEqual([
      'packages/core/package.json',
      'packages/core/CHANGELOG.md',
      'tmp/.release-summary',
      'tmp/.release-tags',
    ]);
  });

  it('if a write fails, names the files already written', () => {
    failOn('packages/core/CHANGELOG.md');

    expect(() => applyReleasePlan(makePlan())).toThrow('1 of 4 files were written:\n  packages/core/package.json');
  });

  it('if a write fails, names the files not written', () => {
    failOn('packages/core/CHANGELOG.md');

    expect(() => applyReleasePlan(makePlan())).toThrow(
      'Not written:\n  packages/core/CHANGELOG.md\n  tmp/.release-summary\n  tmp/.release-tags',
    );
  });

  it('if a write fails, gives the command that reverts what landed', () => {
    failOn('packages/core/CHANGELOG.md');

    expect(() => applyReleasePlan(makePlan())).toThrow('git restore packages/core/package.json');
  });

  it('if a write fails, reports the underlying error', () => {
    failOn('packages/core/package.json', 'EACCES: permission denied');

    expect(() => applyReleasePlan(makePlan())).toThrow(
      'Failed to write packages/core/package.json: EACCES: permission denied',
    );
  });

  it('if the first write fails, reports that nothing was written', () => {
    failOn('packages/core/package.json');

    expect(() => applyReleasePlan(makePlan())).toThrow(
      'The release was not applied. None of its 4 files were written.',
    );
  });

  it('stops at the first failed write', () => {
    failOn('packages/core/package.json');

    expect(() => applyReleasePlan(makePlan())).toThrow('Failed to write packages/core/package.json');
    expect(writtenPaths()).toStrictEqual(['packages/core/package.json']);
  });
});

// region | Helpers
/** Build a release plan, overriding any field of an otherwise two-file release. */
function makePlan(overrides: Partial<ReleasePlan> = {}): ReleasePlan {
  return {
    writes: [
      { path: 'packages/core/package.json', content: '{ "version": "1.0.0" }\n' },
      { path: 'packages/core/CHANGELOG.md', content: '# Changelog\n' },
    ],
    tags: ['core-v1.0.0'],
    summary: 'core-v1.0.0\n- feat: Add a thing',
    formatCommand: undefined,
    workspaces: [],
    ...overrides,
  };
}

/** Make the write of `path` fail, leaving every other write successful. */
function failOn(path: string, error = 'ENOSPC: no space left on device'): void {
  mockWriteFileWithCheck.mockImplementation((filePath: string) =>
    filePath === path ? { filePath, outcome: 'failed', error } : { filePath, outcome: 'created' },
  );
}

/** Paths passed to `writeFileWithCheck`, in call order. */
function writtenPaths(): string[] {
  return mockWriteFileWithCheck.mock.calls.map(([path]) => path);
}
// endregion | Helpers
