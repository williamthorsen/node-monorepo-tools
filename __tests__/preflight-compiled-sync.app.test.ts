import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { compileConfig } from '../packages/preflight/src/compile/compileConfig.js';

const distributionDir = join(import.meta.dirname, '..', '.preflight', 'distribution');

describe('preflight distribution', () => {
  it('nmr.js is up to date with nmr.ts', async () => {
    const srcPath = join(distributionDir, 'nmr.ts');
    const checkedInPath = join(distributionDir, 'nmr.js');
    const tmpPath = join(distributionDir, 'nmr.compiled-check.js');

    try {
      await compileConfig(srcPath, tmpPath);
      const expected = readFileSync(tmpPath, 'utf8');
      const actual = readFileSync(checkedInPath, 'utf8');

      expect(actual).toBe(expected);
    } finally {
      try {
        unlinkSync(tmpPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  });
});
