import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { buildRepo } from '../fixture-repo.ts';

describe(buildRepo, () => {
  it('writes each named file, creating parent directories as needed', () => {
    const dir = buildRepo({
      'package.json': '{ "name": "root" }\n',
      'packages/api/src/index.ts': 'export {};\n',
    });

    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe('{ "name": "root" }\n');
    expect(readFileSync(join(dir, 'packages/api/src/index.ts'), 'utf8')).toBe('export {};\n');
  });

  it('removes the directory when the test finishes', () => {
    let dir = '';
    // Registered before buildRepo so that it runs after buildRepo's own cleanup: Vitest unwinds these in reverse.
    onTestFinished(() => {
      expect(existsSync(dir)).toBe(false);
    });

    dir = buildRepo({ 'package.json': '{}\n' });

    expect(existsSync(dir)).toBe(true);
  });
});
