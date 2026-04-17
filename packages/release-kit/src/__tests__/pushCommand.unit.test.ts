import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPushRelease = vi.hoisted(() => vi.fn());
const mockResolveCommandTags = vi.hoisted(() => vi.fn());

vi.mock('../pushRelease.ts', () => ({
  pushRelease: mockPushRelease,
}));

vi.mock('../resolveCommandTags.ts', () => ({
  resolveCommandTags: mockResolveCommandTags,
}));

import { pushCommand } from '../pushCommand.ts';
import type { ResolvedTag } from '../resolveReleaseTags.ts';

/** Sentinel error thrown by the mocked process.exit. */
class ExitError extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

const TAGS: ResolvedTag[] = [
  { tag: 'core-v1.2.0', dir: 'core', workspacePath: 'packages/core' },
  { tag: 'cli-v0.5.0', dir: 'cli', workspacePath: 'packages/cli' },
];

describe(pushCommand, () => {
  beforeEach(() => {
    mockResolveCommandTags.mockResolvedValue(TAGS);
    mockPushRelease.mockReturnValue([]);
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitError(typeof code === 'number' ? code : undefined);
    });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    mockPushRelease.mockReset();
    mockResolveCommandTags.mockReset();
    vi.restoreAllMocks();
  });

  it('delegates to pushRelease with default options', async () => {
    await pushCommand([]);

    expect(mockResolveCommandTags).toHaveBeenCalledWith(undefined);
    expect(mockPushRelease).toHaveBeenCalledWith(TAGS, { dryRun: false, tagsOnly: false });
  });

  it('passes dryRun when --dry-run is provided', async () => {
    await pushCommand(['--dry-run']);

    expect(mockPushRelease).toHaveBeenCalledWith(TAGS, { dryRun: true, tagsOnly: false });
  });

  it('passes tagsOnly when --tags-only is provided', async () => {
    await pushCommand(['--tags-only']);

    expect(mockPushRelease).toHaveBeenCalledWith(TAGS, { dryRun: false, tagsOnly: true });
  });

  it('passes only filter to resolveCommandTags', async () => {
    await pushCommand(['--only=core,cli']);

    expect(mockResolveCommandTags).toHaveBeenCalledWith(['core', 'cli']);
  });

  it('exits with code 1 on unknown flags', async () => {
    let thrown: ExitError | undefined;
    try {
      await pushCommand(['--unknown']);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Error: Unknown option: --unknown');
    expect(mockPushRelease).not.toHaveBeenCalled();
  });

  it('exits with code 1 when pushRelease throws', async () => {
    mockPushRelease.mockImplementation(() => {
      throw new Error('push failed');
    });

    let thrown: ExitError | undefined;
    try {
      await pushCommand([]);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith('push failed');
  });

  it('skips pushRelease when no tags are resolved', async () => {
    mockResolveCommandTags.mockResolvedValue([]);

    await pushCommand([]);

    expect(mockPushRelease).not.toHaveBeenCalled();
  });
});
