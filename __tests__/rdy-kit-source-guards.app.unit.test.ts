import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { findMonorepoRoot, getWorkspacePackageDirs } from '@williamthorsen/nmr/workspace';
import { describe, expect, it } from 'vitest';

const monorepoRoot = findMonorepoRoot(import.meta.dirname);
const JSON_IMPORT_ATTRIBUTE_PATTERN = /\b(?:with|assert)\s*\{\s*type\s*:\s*['"]json['"]\s*}/;

const kitSourceFiles = findKitSources();

/**
 * Guards every `.readyup/kits/*.ts` source against a native `with { type: 'json' }` import, which makes esbuild
 * (invoked by `rdy compile`) inline the entire JSON file into the compiled kit. Use `pickJson` instead.
 */
describe('rdy kit source files', () => {
  it('finds kit sources to check', () => {
    expect(kitSourceFiles.length).toBeGreaterThan(0);
  });

  it.each(kitSourceFiles)('%s does not use JSON import attributes', (file) => {
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
