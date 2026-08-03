import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { findMonorepoRoot, getWorkspacePackageDirs } from '@williamthorsen/nmr/workspace';
import { describe, expect, it } from 'vitest';

const monorepoRoot = findMonorepoRoot(import.meta.dirname);
const JSON_IMPORT_ATTRIBUTE_PATTERN = /\b(?:with|assert)\s*\{\s*type\s*:\s*['"]json['"]\s*}/;

const kitSourceFiles = findKitSources();

/**
 * Guards against reintroducing the JSON-inlining footgun in a `.readyup/kits/*.ts` source.
 * A native `with { type: 'json' }` import causes esbuild (invoked by `rdy compile`)
 * to inline the entire JSON file into the compiled kit. Use `pickJson` instead.
 */
describe('rdy kit source files', () => {
  // A package publishing kits carries its own `.readyup/`, so a guard scanning one fixed directory would stop
  // covering the kits that move out of it.
  it('finds kit sources to check', () => {
    expect(kitSourceFiles.length).toBeGreaterThan(0);
  });

  it.each(kitSourceFiles)('%s uses no JSON import attributes', (file) => {
    const content = readFileSync(join(monorepoRoot, file), 'utf8');

    expect(JSON_IMPORT_ATTRIBUTE_PATTERN.test(content)).toBe(false);
  });
});

/** Collects every kit source in the repo, as monorepo-relative paths, from the root and each workspace package. */
function findKitSources(): string[] {
  return [monorepoRoot, ...getWorkspacePackageDirs(monorepoRoot)]
    .map((dir) => join(dir, '.readyup', 'kits'))
    .filter((kitsDir) => existsSync(kitsDir))
    .flatMap((kitsDir) =>
      readdirSync(kitsDir)
        .filter((name) => name.endsWith('.ts'))
        .map((name) => relative(monorepoRoot, join(kitsDir, name))),
    )
    .toSorted();
}
