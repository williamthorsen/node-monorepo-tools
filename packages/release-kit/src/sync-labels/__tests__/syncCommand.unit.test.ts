import { captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
}));

import { makeFakeGh } from '../../test-utils/makeFakeGh.ts';
import { syncLabelsCommand } from '../syncCommand.ts';

describe(syncLabelsCommand, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
  });

  it('returns 1 when gh CLI is not available', () => {
    const gh = makeFakeGh({ isAvailable: () => false });
    using stdioCapture = captureStdio();

    const result = syncLabelsCommand(gh);

    expect(result).toBe(1);
    expect(stdioCapture.stderr).toContain('gh');
  });

  it('returns 1 when workflow file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    const gh = makeFakeGh();
    using stdioCapture = captureStdio();

    const result = syncLabelsCommand(gh);

    expect(result).toBe(1);
    expect(stdioCapture.stderr).toContain('sync-labels.yaml');
  });

  it('returns 0 and triggers workflow on success', () => {
    stubExistingFiles('.github/workflows/sync-labels.yaml');
    const gh = makeFakeGh();
    using _silencedConsole = silenceConsole(['info']);

    const result = syncLabelsCommand(gh);

    expect(result).toBe(0);
    expect(gh.runWorkflow).toHaveBeenCalledExactlyOnceWith('sync-labels.yaml');
  });

  it('returns 1 when gh workflow run throws', () => {
    stubExistingFiles('.github/workflows/sync-labels.yaml');
    const gh = makeFakeGh({
      runWorkflow: () => {
        throw new Error('workflow dispatch failed');
      },
    });
    using stdioCapture = captureStdio();

    const result = syncLabelsCommand(gh);

    expect(result).toBe(1);
    expect(stdioCapture.stderr).toContain('workflow dispatch failed');
  });
});

// region | Helpers

/** Makes only the given repo files exist. */
function stubExistingFiles(...paths: string[]): void {
  mockExistsSync.mockImplementation((path: string) => paths.includes(path));
}

// endregion | Helpers
