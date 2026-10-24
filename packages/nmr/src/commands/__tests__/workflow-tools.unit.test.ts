import { createHash } from 'node:crypto';
import path from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserError } from '../../UserError.ts';
import { ensureTool, resolveToolPlatform, TOOL_PINS, type ToolPins } from '../workflow-tools.ts';

describe(ensureTool, () => {
  let tree: TempTree;
  let cacheRoot: string;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-workflow-tools-test-' }));
    cacheRoot = path.join(tree.dir, 'cache');
  });

  it('returns a cached binary without downloading', async () => {
    tree.write('cache/actionlint-1.7.12/actionlint', '#!/bin/sh\n');
    const fetch = vi.fn<typeof globalThis.fetch>();

    const binaryPath = await ensureTool('actionlint', { arch: 'arm64', cacheRoot, fetch, platform: 'darwin' });

    expect(binaryPath).toBe(path.join(cacheRoot, 'actionlint-1.7.12', 'actionlint'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an archive whose checksum does not match the pin and caches nothing', async () => {
    const pins = buildPins(sha256Of('the pinned archive'));
    const fetch = vi.fn(() => Promise.resolve(new Response('a tampered archive')));

    await expect(ensureTool('actionlint', { arch: 'x64', cacheRoot, fetch, pins, platform: 'linux' })).rejects.toThrow(
      /^Checksum mismatch for https:\/\/example\.test\/actionlint\.tar\.gz/,
    );
    expect(tree.list('cache')).toStrictEqual([]);
  });

  it('names the URL and the status of a failed download', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('', { status: 404 })));

    await expect(
      ensureTool('actionlint', { arch: 'x64', cacheRoot, fetch, pins: buildPins('0'), platform: 'linux' }),
    ).rejects.toThrow('Cannot download https://example.test/actionlint.tar.gz: HTTP 404');
    expect(tree.list('cache')).toStrictEqual([]);
  });

  it('names the URL when the request itself fails', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('getaddrinfo ENOTFOUND example.test')));

    await expect(
      ensureTool('actionlint', { arch: 'x64', cacheRoot, fetch, pins: buildPins('0'), platform: 'linux' }),
    ).rejects.toThrow('Cannot download https://example.test/actionlint.tar.gz: getaddrinfo ENOTFOUND example.test');
  });
});

describe(resolveToolPlatform, () => {
  it.each([
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['linux', 'arm64'],
    ['linux', 'x64'],
  ] as const)('accepts %s on %s', (platform, arch) => {
    expect(resolveToolPlatform(platform, arch)).toBe(`${platform}-${arch}`);
  });

  it.each([
    ['win32', 'x64'],
    ['linux', 'arm'],
  ] as const)('rejects %s on %s, naming the pair', (platform, arch) => {
    expect(() => resolveToolPlatform(platform, arch)).toThrow(UserError);
    expect(() => resolveToolPlatform(platform, arch)).toThrow(`does not support ${platform}-${arch}`);
  });
});

describe('TOOL_PINS', () => {
  it('pins a SHA-256 for every supported platform of every tool', () => {
    for (const pin of Object.values(TOOL_PINS)) {
      for (const asset of Object.values(pin.assets)) {
        expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(asset.url).toMatch(/^https:\/\/github\.com\/.+\.tar\.gz$/);
      }
    }
  });
});

// region | Helpers

/** Builds pins whose every actionlint asset is one URL with the given SHA-256. */
function buildPins(sha256: string): ToolPins {
  const asset = { sha256, url: 'https://example.test/actionlint.tar.gz' };
  return {
    ...TOOL_PINS,
    actionlint: {
      archiveMember: 'actionlint',
      assets: { 'darwin-arm64': asset, 'darwin-x64': asset, 'linux-arm64': asset, 'linux-x64': asset },
      version: '0.0.0',
    },
  };
}

/** Returns the hex SHA-256 of a string. */
function sha256Of(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// endregion | Helpers
