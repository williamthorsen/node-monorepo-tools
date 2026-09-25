import { type CapturedStdio, captureError, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { ProcessExitError, silenceConsole, throwOnProcessExit } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPushRelease = vi.hoisted(() => vi.fn());
const mockResolveCommandTags = vi.hoisted(() => vi.fn());

vi.mock(import('../pushRelease.ts'), () => ({
  pushRelease: mockPushRelease,
}));

vi.mock(import('../resolveCommandTags.ts'), () => ({
  resolveCommandTags: mockResolveCommandTags,
}));

import { pushCommand } from '../pushCommand.ts';
import type { ResolvedTag } from '../resolveReleaseTags.ts';

const TAGS: ResolvedTag[] = [
  { tag: 'core-v1.2.0', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
  { tag: 'cli-v0.5.0', dir: 'cli', workspacePath: 'packages/cli', isPublishable: true },
];

describe(pushCommand, () => {
  let capture: CapturedStdio;

  beforeEach(() => {
    capture = captureStdio();
    mockResolveCommandTags.mockReturnValue(TAGS);
    mockPushRelease.mockReturnValue([]);
    void throwOnProcessExit();
    void silenceConsole(['info']);
  });

  afterEach(() => {
    capture[Symbol.dispose]();
    mockPushRelease.mockReset();
    mockResolveCommandTags.mockReset();
    vi.restoreAllMocks();
  });

  it('delegates to pushRelease with default options', () => {
    pushCommand([]);

    expect(mockResolveCommandTags).toHaveBeenCalledWith(undefined, undefined);
    expect(mockPushRelease).toHaveBeenCalledWith(TAGS, { dryRun: false, tagsOnly: false });
  });

  it('passes dryRun when --dry-run is provided', () => {
    pushCommand(['--dry-run']);

    expect(mockPushRelease).toHaveBeenCalledWith(TAGS, { dryRun: true, tagsOnly: false });
  });

  it('passes tagsOnly when --tags-only is provided', () => {
    pushCommand(['--tags-only']);

    expect(mockPushRelease).toHaveBeenCalledWith(TAGS, { dryRun: false, tagsOnly: true });
  });

  it('passes tags filter to resolveCommandTags', () => {
    pushCommand(['--tags=core-v1.2.0,cli-v0.5.0']);

    expect(mockResolveCommandTags).toHaveBeenCalledWith(['core-v1.2.0', 'cli-v0.5.0'], undefined);
  });

  it('combines --tags with --tags-only to push only the tag subset', () => {
    pushCommand(['--tags=core-v1.2.0', '--tags-only']);

    expect(mockResolveCommandTags).toHaveBeenCalledWith(['core-v1.2.0'], undefined);
    expect(mockPushRelease).toHaveBeenCalledWith(TAGS, { dryRun: false, tagsOnly: true });
  });

  it('propagates unknown-tag error from resolveCommandTags', async () => {
    mockResolveCommandTags.mockImplementation(() => {
      throw new ProcessExitError(1);
    });

    const error = await captureError(ProcessExitError, () => pushCommand(['--tags=missing-v9.9.9']));

    expect(error.code).toBe(1);
    expect(mockPushRelease).not.toHaveBeenCalled();
  });

  it('exits with code 1 when --only is passed (flag removed)', async () => {
    const error = await captureError(ProcessExitError, () => pushCommand(['--only=core']));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain('Error: Unknown option: --only\n');
  });

  it('exits with code 1 on unknown flags', async () => {
    const error = await captureError(ProcessExitError, () => pushCommand(['--unknown']));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain('Error: Unknown option: --unknown\n');
    expect(mockPushRelease).not.toHaveBeenCalled();
  });

  it('rejects --config, which it reads no config to honor', async () => {
    const error = await captureError(ProcessExitError, () => pushCommand(['--config', 'alt.config.ts']));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain('Error: Unknown option: --config\n');
  });

  it('exits with code 1 when pushRelease throws', async () => {
    mockPushRelease.mockImplementation(() => {
      throw new Error('push failed');
    });

    const error = await captureError(ProcessExitError, () => pushCommand([]));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain('Error: push failed\n');
  });

  it('skips pushRelease when no tags are resolved', () => {
    mockResolveCommandTags.mockReturnValue([]);

    pushCommand([]);

    expect(mockPushRelease).not.toHaveBeenCalled();
  });
});
