import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..');

describe('nmr kit audit config migration checks against this repo', () => {
  it('passes: the repo does not have a legacy .audit-ci/ directory', () => {
    expect(existsSync(join(repoRoot, '.audit-ci'))).toBe(false);
  });
});

describe('v11y-check kit checks against this repo', () => {
  it('passes: v11y-check config exists', () => {
    expect(existsSync(join(repoRoot, '.config/v11y-check.config.json'))).toBe(true);
  });
});
