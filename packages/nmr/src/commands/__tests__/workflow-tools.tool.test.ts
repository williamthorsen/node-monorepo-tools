import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureTool, type EnsureToolOptions, TOOL_PINS, type ToolPins } from '../workflow-tools.ts';

describe(ensureTool, () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-workflow-tools-tool-test-' }));
  });

  it('extracts the verified binary into the cache, executable, and reuses it on the next call', async () => {
    tree.write('archive-src/shellcheck-v9.9.9/shellcheck', '#!/bin/sh\necho fake shellcheck\n');
    const archivePath = path.join(tree.dir, 'fixture.tar.gz');
    execFileSync('tar', ['-czf', archivePath, '-C', path.join(tree.dir, 'archive-src'), 'shellcheck-v9.9.9'], {
      stdio: 'pipe',
    });
    const archive = fs.readFileSync(archivePath);
    const pins = buildShellcheckPins(createHash('sha256').update(archive).digest('hex'));
    const fetch = vi.fn(() => Promise.resolve(new Response(archive)));
    const options: EnsureToolOptions = {
      arch: 'arm64',
      cacheRoot: path.join(tree.dir, 'cache'),
      fetch,
      pins,
      platform: 'darwin',
    };

    const binaryPath = await ensureTool('shellcheck', options);
    const secondPath = await ensureTool('shellcheck', options);

    expect(binaryPath).toBe(path.join(tree.dir, 'cache', 'shellcheck-9.9.9', 'shellcheck'));
    expect(secondPath).toBe(binaryPath);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(execFileSync(binaryPath, { encoding: 'utf8', stdio: 'pipe' })).toBe('fake shellcheck\n');
    expect(tree.list('cache')).toStrictEqual(['shellcheck-9.9.9']);
  });
});

// region | Helpers

/** Builds pins whose every shellcheck asset is the fixture archive with the given SHA-256. */
function buildShellcheckPins(sha256: string): ToolPins {
  const asset = { sha256, url: 'https://example.test/shellcheck.tar.gz' };
  return {
    ...TOOL_PINS,
    shellcheck: {
      archiveMember: 'shellcheck-v9.9.9/shellcheck',
      assets: { 'darwin-arm64': asset, 'darwin-x64': asset, 'linux-arm64': asset, 'linux-x64': asset },
      version: '9.9.9',
    },
  };
}

// endregion | Helpers
