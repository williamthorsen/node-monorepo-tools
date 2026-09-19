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
  let capture: CapturedStdio;

  beforeEach(() => {
    capture = captureStdio();
    mockCreateTags.mockReturnValue([]);
    void throwOnProcessExit();
    void silenceConsole(['info']);
  });

  afterEach(() => {
    capture[Symbol.dispose]();
    mockCreateTags.mockReset();
    vi.restoreAllMocks();
  });

  it('delegates to createTags with default options', () => {
    tagCommand([], RICH_STYLES);

    expect(mockCreateTags).toHaveBeenCalledWith({ dryRun: false, noGitChecks: false, style: 'rich' });
  });

  it('passes dryRun when --dry-run is provided', () => {
    tagCommand(['--dry-run'], RICH_STYLES);

    expect(mockCreateTags).toHaveBeenCalledWith({ dryRun: true, noGitChecks: false, style: 'rich' });
  });

  it('passes noGitChecks when --no-git-checks is provided', () => {
    tagCommand(['--no-git-checks'], RICH_STYLES);

    expect(mockCreateTags).toHaveBeenCalledWith({ dryRun: false, noGitChecks: true, style: 'rich' });
  });

  it('passes both flags when both are provided', () => {
    tagCommand(['--dry-run', '--no-git-checks'], RICH_STYLES);

    expect(mockCreateTags).toHaveBeenCalledWith({ dryRun: true, noGitChecks: true, style: 'rich' });
  });

  it('exits with code 1 on unknown flags', async () => {
    const error = await captureError(ProcessExitError, () => tagCommand(['--unknown'], RICH_STYLES));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain('Error: Unknown option: --unknown\n');
    expect(mockCreateTags).not.toHaveBeenCalled();
  });

  it('rejects --config, which it reads no config to honor', async () => {
    const error = await captureError(ProcessExitError, () => tagCommand(['--config', 'alt.config.ts'], RICH_STYLES));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain('Error: Unknown option: --config\n');
  });

  it('exits with code 1 when createTags throws', async () => {
    mockCreateTags.mockImplementation(() => {
      throw new Error('No tags file found. Run `release-kit prepare` first.');
    });

    const error = await captureError(ProcessExitError, () => tagCommand([], RICH_STYLES));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain('Error: No tags file found. Run `release-kit prepare` first.\n');
  });
});
