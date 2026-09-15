import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WORK_TYPES_JSON_PATH } from '../workTypesUtils.ts';

describe('WORK_TYPES_JSON_PATH', () => {
  it("names the committed work-types.json in the package's src directory", () => {
    const packageDir = resolve(import.meta.dirname, '..', '..');

    expect(WORK_TYPES_JSON_PATH).toBe(resolve(packageDir, 'src', 'work-types.json'));
    expect(existsSync(WORK_TYPES_JSON_PATH)).toBe(true);
  });
});
