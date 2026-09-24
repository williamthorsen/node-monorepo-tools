import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it } from 'vitest';

const BIN_PATH = path.resolve(import.meta.dirname, '..', 'release-kit.ts');

const HELP_INVOCATIONS = [
  ['--help'],
  ['commit', '--help'],
  ['create-github-release', '--help'],
  ['init', '--help'],
  ['overrides'],
  ['overrides', 'validate', '--help'],
  ['prepare', '--help'],
  ['publish', '--help'],
  ['push', '--help'],
  ['show-tag-prefixes', '--help'],
  ['sync-labels'],
  ['sync-labels', 'generate', '--help'],
  ['sync-labels', 'init', '--help'],
  ['sync-labels', 'sync', '--help'],
  ['tag', '--help'],
];

describe('release-kit bin outside a repo', () => {
  it('prints the version', () => {
    const result = runBinOutsideRepo(['--version']);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it.each(HELP_INVOCATIONS)('prints help for %s', (...args) => {
    const result = runBinOutsideRepo(args);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: release-kit');
  });

  it('fails a command with the message naming what it looked for', () => {
    const result = runBinOutsideRepo(['show-tag-prefixes']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('No repo root found from');
  });
});

// region | Helpers
/** Runs the source bin under bare node from an empty temp directory, which is under no repo root. */
function runBinOutsideRepo(args: string[]): SpawnSyncReturns<string> {
  const tree = disposeOnTestFinished(createTempTree({}, { prefix: 'release-kit-norepo-' }));
  return spawnSync(process.execPath, [BIN_PATH, ...args], {
    cwd: tree.dir,
    encoding: 'utf8',
    timeout: 15_000,
  });
}
// endregion | Helpers
