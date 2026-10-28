import type { StreamStyles } from '@williamthorsen/nmr-core';
import { type CapturedStdio, captureError, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { ProcessExitError, silenceConsole, throwOnProcessExit } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateTags = vi.hoisted(() => vi.fn());

vi.mock(import('../createTags.ts'), () => ({
  createTags: mockCreateTags,
}));

import { tagCommand } from '../tagCommand.ts';

const RICH_STYLES: StreamStyles = { stderr: 'rich', stdout: 'rich' };

describe(tagCommand, () => {
  let stdioCapture: CapturedStdio;

  beforeEach(() => {
    stdioCapture = captureStdio();
    mockCreateTags.mockReturnValue([]);
    void throwOnProcessExit();
    void silenceConsole(['info']);
  });

  afterEach(() => {
    stdioCapture[Symbol.dispose]();
    mockCreateTags.mockReset();
    vi.restoreAllMocks();
  });

  it('delegates to createTags with default options', () => {
    tagCommand([], RICH_STYLES);

    expect(mockCreateTags).toHaveBeenCalledWith({ isDryRun: false, shouldSkipGitChecks: false, style: 'rich' });
  });

  it('passes isDryRun when --dry-run is provided', () => {
    tagCommand(['--dry-run'], RICH_STYLES);

    expect(mockCreateTags).toHaveBeenCalledWith({ isDryRun: true, shouldSkipGitChecks: false, style: 'rich' });
  });

  it('passes shouldSkipGitChecks when --no-git-checks is provided', () => {
    tagCommand(['--no-git-checks'], RICH_STYLES);

    expect(mockCreateTags).toHaveBeenCalledWith({ isDryRun: false, shouldSkipGitChecks: true, style: 'rich' });
  });

  it('passes both flags when both are provided', () => {
    tagCommand(['--dry-run', '--no-git-checks'], RICH_STYLES);

    expect(mockCreateTags).toHaveBeenCalledWith({ isDryRun: true, shouldSkipGitChecks: true, style: 'rich' });
  });

  it('exits with code 1 on unknown flags', async () => {
    const error = await captureError(ProcessExitError, () => tagCommand(['--unknown'], RICH_STYLES));

    expect(error.code).toBe(1);
    expect(stdioCapture.stderrChunks).toContain('Error: Unknown option: --unknown\n');
    expect(mockCreateTags).not.toHaveBeenCalled();
  });

  it('rejects --config, because the command does not read any config', async () => {
    const error = await captureError(ProcessExitError, () => tagCommand(['--config', 'alt.config.ts'], RICH_STYLES));

    expect(error.code).toBe(1);
    expect(stdioCapture.stderrChunks).toContain('Error: Unknown option: --config\n');
  });

  it('exits with code 1 when createTags throws', async () => {
    mockCreateTags.mockImplementation(() => {
      throw new Error('No tags file found. Run `release-kit prepare` first.');
    });

    const error = await captureError(ProcessExitError, () => tagCommand([], RICH_STYLES));

    expect(error.code).toBe(1);
    expect(stdioCapture.stderrChunks).toContain('Error: No tags file found. Run `release-kit prepare` first.\n');
  });
});
