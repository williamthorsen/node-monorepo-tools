import { type CapturedStdio, captureError, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { ProcessExitError, silenceConsole, throwOnProcessExit } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateTags = vi.hoisted(() => vi.fn());

vi.mock(import('../createTags.ts'), () => ({
  createTags: mockCreateTags,
}));

import { tagCommand } from '../tagCommand.ts';

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
    tagCommand([]);

    expect(mockCreateTags).toHaveBeenCalledWith({ dryRun: false, noGitChecks: false });
  });

  it('passes dryRun when --dry-run is provided', () => {
    tagCommand(['--dry-run']);

    expect(mockCreateTags).toHaveBeenCalledWith({ dryRun: true, noGitChecks: false });
  });

  it('passes noGitChecks when --no-git-checks is provided', () => {
    tagCommand(['--no-git-checks']);

    expect(mockCreateTags).toHaveBeenCalledWith({ dryRun: false, noGitChecks: true });
  });

  it('passes both flags when both are provided', () => {
    tagCommand(['--dry-run', '--no-git-checks']);

    expect(mockCreateTags).toHaveBeenCalledWith({ dryRun: true, noGitChecks: true });
  });

  it('exits with code 1 on unknown flags', async () => {
    const error = await captureError(ProcessExitError, () => tagCommand(['--unknown']));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain('Error: Unknown option: --unknown\n');
    expect(mockCreateTags).not.toHaveBeenCalled();
  });

  it('exits with code 1 when createTags throws', async () => {
    mockCreateTags.mockImplementation(() => {
      throw new Error('No tags file found. Run `release-kit prepare` first.');
    });

    const error = await captureError(ProcessExitError, () => tagCommand([]));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain('Error: No tags file found. Run `release-kit prepare` first.\n');
  });
});
