import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const kitsDir = join(import.meta.dirname, '..', '.readyup', 'kits');
const JSON_IMPORT_ATTRIBUTE_PATTERN = /\b(?:with|assert)\s*\{\s*type\s*:\s*['"]json['"]\s*\}/;

const kitSourceFiles = readdirSync(kitsDir).filter((name) => name.endsWith('.ts'));

/**
 * Guards against reintroducing the JSON-inlining footgun in `.readyup/kits/*.ts`.
 * A native `with { type: 'json' }` import causes esbuild (invoked by `rdy compile`)
 * to inline the entire JSON file into the compiled kit. Use `pickJson` instead.
 */
describe('rdy kit source files', () => {
  for (const file of kitSourceFiles) {
    it(`${file} uses no JSON import attributes`, () => {
      const content = readFileSync(join(kitsDir, file), 'utf8');
      expect(
        JSON_IMPORT_ATTRIBUTE_PATTERN.test(content),
        `${file} contains a \`with { type: 'json' }\` or \`assert { type: 'json' }\` import attribute. ` +
          'Replace it with `pickJson(relativePath, keys)` from readyup — the native JSON import inlines the entire file into the compiled kit.',
      ).toBe(false);
    });
  }
});
