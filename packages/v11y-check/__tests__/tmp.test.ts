import { existsSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { withTempDir } from '../src/tmp.ts';

describe(withTempDir, () => {
  it('provides a directory that exists during the callback', async () => {
    let capturedDir = '';

    await withTempDir((dir) => {
      capturedDir = dir;
      expect(existsSync(dir)).toBe(true);
      expect(statSync(dir).isDirectory()).toBe(true);
      return Promise.resolve();
    });

    expect(capturedDir.length).toBeGreaterThan(0);
  });

  it('cleans up the directory after the callback completes', async () => {
    let capturedDir = '';

    await withTempDir(async (dir) => {
      capturedDir = dir;
      await writeFile(path.join(dir, 'test.txt'), 'hello', 'utf8');
    });

    expect(existsSync(capturedDir)).toBe(false);
  });

  it('cleans up the directory when the callback throws', async () => {
    let capturedDir = '';

    await expect(
      withTempDir((dir) => {
        capturedDir = dir;
        throw new Error('intentional');
      }),
    ).rejects.toThrow('intentional');

    expect(existsSync(capturedDir)).toBe(false);
  });

  it('returns the value from the callback', async () => {
    const result = await withTempDir(() => Promise.resolve(42));
    expect(result).toBe(42);
  });
});
