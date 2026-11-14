import { type StreamStyles, UserError } from '@williamthorsen/nmr-core';
import { type CapturedStdio, captureError, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateTags = vi.hoisted(() => vi.fn());

vi.mock(import('../createTags.ts'), () => ({
  createTags: mockCreateTags,
}));

import { tagCommand } from '../tagCommand.ts';
import { makeTagOptions } from '../test-utils/commandOptions.ts';

const RICH_STYLES: StreamStyles = { stderr: 'rich', stdout: 'rich' };

describe(tagCommand, () => {
  let stdioCapture: CapturedStdio;

  beforeEach(() => {
    stdioCapture = captureStdio();
    mockCreateTags.mockReturnValue([]);
  });

  afterEach(() => {
    stdioCapture[Symbol.dispose]();
    mockCreateTags.mockReset();
    vi.restoreAllMocks();
  });

  it('delegates to createTags with default options', () => {
    tagCommand(makeTagOptions({ styles: RICH_STYLES }));

    expect(mockCreateTags).toHaveBeenCalledWith({ isDryRun: false, shouldSkipGitChecks: false, style: 'rich' });
  });

  it('passes isDryRun when --dry-run is provided', () => {
    tagCommand(makeTagOptions({ isDryRun: true, styles: RICH_STYLES }));

    expect(mockCreateTags).toHaveBeenCalledWith({ isDryRun: true, shouldSkipGitChecks: false, style: 'rich' });
  });

  it('passes shouldSkipGitChecks when --no-git-checks is provided', () => {
    tagCommand(makeTagOptions({ shouldSkipGitChecks: true, styles: RICH_STYLES }));

    expect(mockCreateTags).toHaveBeenCalledWith({ isDryRun: false, shouldSkipGitChecks: true, style: 'rich' });
  });

  it('passes both flags when both are provided', () => {
    tagCommand(makeTagOptions({ isDryRun: true, shouldSkipGitChecks: true, styles: RICH_STYLES }));

    expect(mockCreateTags).toHaveBeenCalledWith({ isDryRun: true, shouldSkipGitChecks: true, style: 'rich' });
  });

  it('rethrows the UserError when createTags throws', async () => {
    mockCreateTags.mockImplementation(() => {
      throw new UserError('No tags file found. Run `release-kit prepare` first.');
    });

    const error = await captureError(UserError, () => tagCommand(makeTagOptions({ styles: RICH_STYLES })));
    expect(error.message).toBe('No tags file found. Run `release-kit prepare` first.');
  });
});
