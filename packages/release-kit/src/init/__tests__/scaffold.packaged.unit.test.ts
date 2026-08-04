import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert, describe, expect, it } from 'vitest';

const thisDir = dirname(fileURLToPath(import.meta.url));
const distScaffoldPath = join(thisDir, '..', '..', '..', 'dist', 'esm', 'init', 'scaffold.js');

interface ScaffoldModule {
  copyCliffTemplate: (dryRun: boolean, overwrite: boolean) => void;
}

/** Check whether a dynamic import result exports `copyCliffTemplate` as a function. */
function isScaffoldModule(value: unknown): value is ScaffoldModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'copyCliffTemplate' in value &&
    typeof value.copyCliffTemplate === 'function'
  );
}

describe('copyCliffTemplate (packaged)', () => {
  it('resolves cliff.toml.template from the built output and writes .config/git-cliff.toml', async () => {
    assert(
      existsSync(distScaffoldPath),
      `Built output not found at ${distScaffoldPath}. Run \`nmr build\` before running this test.`,
    );

    const tempDir = mkdtempSync(join(tmpdir(), 'scaffold-packaged-'));
    const originalCwd = process.cwd();

    try {
      process.chdir(tempDir);

      // Import from the compiled JS so that `import.meta.url` points to dist/esm/init/scaffold.js.
      const mod: unknown = await import(distScaffoldPath);
      assert(isScaffoldModule(mod), 'Module does not export `copyCliffTemplate` as a function');

      mod.copyCliffTemplate(false, false);

      const cliffTomlPath = join(tempDir, '.config', 'git-cliff.toml');
      expect(existsSync(cliffTomlPath)).toBe(true);

      const content = readFileSync(cliffTomlPath, 'utf8');
      expect(content).toContain('# git-cliff configuration');
    } finally {
      process.chdir(originalCwd);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
