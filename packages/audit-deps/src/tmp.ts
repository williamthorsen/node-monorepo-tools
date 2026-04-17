import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Execute a callback with a temporary directory, ensuring cleanup afterward.
 *
 * Creates a unique temp directory under `os.tmpdir()` and removes it
 * (recursively) when the callback completes or throws.
 *
 * @internal Exported for testing.
 */
export async function withTempDir<T>(fn: (tempDir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'audit-deps-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
