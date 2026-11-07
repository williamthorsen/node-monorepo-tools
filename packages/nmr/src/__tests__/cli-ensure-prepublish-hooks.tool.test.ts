import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MONOREPO_ROOT, NMR_PACKAGE_DIR } from '../test-utils/nmr-bin-harness.ts';
import { readAmbientEnv } from '../test-utils/readAmbientEnv.ts';

const BIN_PATH = path.join(NMR_PACKAGE_DIR, 'dist', 'esm', 'cli-ensure-prepublish-hooks.js');

describe('ensure-prepublish-hooks', () => {
  it('reports an unknown flag as a usage error and exits 2', () => {
    const result = runBin(['--bogus']);

    expect(result.status).toBe(2);
    expect(result.stderr).toBe(
      "ensure-prepublish-hooks: Unknown option: --bogus\nTry 'ensure-prepublish-hooks --help'.\n",
    );
  });

  it('prints help from the flag definitions', () => {
    const result = runBin(['--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--dry-run');
    expect(result.stdout).toContain('--command <command>');
  });
});

// region | Helpers

/** Runs the built bin from the monorepo root, which it never writes to without `--fix`. */
function runBin(args: string[]): { status: number | null; stderr: string; stdout: string } {
  return spawnSync('node', [BIN_PATH, ...args], {
    cwd: MONOREPO_ROOT,
    encoding: 'utf8',
    env: readAmbientEnv(),
    timeout: 15_000,
  });
}

// endregion | Helpers
