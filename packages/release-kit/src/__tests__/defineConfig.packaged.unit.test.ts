import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The `@williamthorsen/release-kit/config` entry ships as `dist/esm/defineConfig.js`, and what keeps a config load off
 * the rest of the package is that file's empty module graph.
 *
 * `defineConfig.tool.test.ts` covers the source, whose type-only forms a stripper erases. This covers the emit, which
 * `nmr-compile` produces through an AST pass of its own over module specifiers.
 */

const BUILT_ENTRY_PATH = path.resolve(import.meta.dirname, '../../dist/esm/defineConfig.js');

/** Every syntactic form that pulls another module in: a `from` clause, a bare or dynamic `import`, a `require`. */
const MODULE_REFERENCE = /\b(?:from\s*['"]|import\s*[('"]|require\s*\()/;

describe('the built ./config entry', () => {
  it('reaches no other module', () => {
    if (!existsSync(BUILT_ENTRY_PATH)) {
      throw new Error(`Built output not found at ${BUILT_ENTRY_PATH}. Run \`nmr build\` before running this test.`);
    }

    expect(readFileSync(BUILT_ENTRY_PATH, 'utf8')).not.toMatch(MODULE_REFERENCE);
  });
});
