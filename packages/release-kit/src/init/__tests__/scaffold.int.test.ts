import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const thisDir = dirname(fileURLToPath(import.meta.url));
const distScaffoldPath = join(thisDir, '..', '..', '..', 'dist', 'esm', 'init', 'scaffold.js');

interface ScaffoldModule {
  copyCliffTemplate: (dryRun: boolean) => void;
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

describe('copyCliffTemplate (integration)', () => {
  it('resolves cliff.toml.template from the built output and writes cliff.toml', async () => {
    if (!existsSync(distScaffoldPath)) {
      throw new Error(
        `Built output not found at ${distScaffoldPath}. Run \`pnpm run ws build\` before running integration tests.`,
      );
    }

    const tempDir = mkdtempSync(join(tmpdir(), 'scaffold-int-'));
    const originalCwd = process.cwd();

    try {
      process.chdir(tempDir);

      // Import from the compiled JS so that `import.meta.url` points to dist/esm/init/scaffold.js.
      const mod: unknown = await import(distScaffoldPath);
      if (!isScaffoldModule(mod)) {
        throw new Error('Module does not export `copyCliffTemplate` as a function');
      }

      mod.copyCliffTemplate(false);

      const cliffTomlPath = join(tempDir, 'cliff.toml');
      expect(existsSync(cliffTomlPath)).toBe(true);

      const content = readFileSync(cliffTomlPath, 'utf8');
      expect(content.length).toBeGreaterThan(0);
    } finally {
      process.chdir(originalCwd);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
