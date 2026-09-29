import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

// `v11y.ts` sets `process.exitCode` and returns, so that output drains before exit. These tests spawn the built bin to
// observe its exit code and that it terminates promptly.
const BIN_PATH = path.resolve(import.meta.dirname, '..', '..', '..', 'dist', 'esm', 'bin', 'v11y.js');

describe('v11y bin process exit', () => {
  beforeAll(() => {
    // Warm node + the v11y dist so that the cold-start delay does not push the first measured spawn toward the
    // timeout.
    spawnSync('node', [BIN_PATH, '--help'], { stdio: 'ignore', timeout: 15_000 });
  });

  it('exits 0 for --version', () => {
    const result = spawnSync('node', [BIN_PATH, '--version'], { timeout: 15_000, encoding: 'utf8' });
    // A lingering-handle hang would hit the timeout and leave status null, failing this assertion.
    expect(result.status).toBe(0);
  });

  it('exits 1 for an unknown command', () => {
    const result = spawnSync('node', [BIN_PATH, 'definitely-not-a-real-command'], {
      timeout: 15_000,
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
  });
});
