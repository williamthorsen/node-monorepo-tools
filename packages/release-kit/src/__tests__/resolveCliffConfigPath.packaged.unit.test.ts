import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert, describe, expect, it } from 'vitest';

const thisDir = dirname(fileURLToPath(import.meta.url));
const distResolverPath = join(thisDir, '..', '..', 'dist', 'esm', 'resolveCliffConfigPath.js');

interface ResolverModule {
  resolveCliffConfigPath: (cliffConfigPath: string | undefined, metaUrl: string) => string;
}

/** Check whether a dynamic import result exports `resolveCliffConfigPath` as a function. */
function isResolverModule(value: unknown): value is ResolverModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'resolveCliffConfigPath' in value &&
    typeof value.resolveCliffConfigPath === 'function'
  );
}

describe('resolveCliffConfigPath (packaged)', () => {
  it('resolves the bundled cliff.toml.template from the built output', async () => {
    assert(
      existsSync(distResolverPath),
      `Built output not found at ${distResolverPath}. Run \`nmr build\` before running this test.`,
    );

    // Import from the compiled JS so that import.meta.url resolution uses dist/esm/ paths.
    const mod: unknown = await import(distResolverPath);
    assert(isResolverModule(mod), 'Module does not export `resolveCliffConfigPath` as a function');

    // Pass the compiled module's URL so the bundled template resolves from dist/esm/resolveCliffConfigPath.js.
    const moduleUrl = new URL(`file://${distResolverPath}`).href;
    const result = mod.resolveCliffConfigPath(undefined, moduleUrl);

    expect(result).toContain('cliff.toml.template');
    expect(existsSync(result)).toBe(true);
  });
});
