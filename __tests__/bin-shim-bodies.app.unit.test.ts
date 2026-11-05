import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { findMonorepoRoot, getWorkspacePackageDirs } from '@williamthorsen/nmr/workspace';
import { describe, expect, it } from 'vitest';

/** Captures the parts of a shim that vary between packages: the build entry, the bin name, and the bootstrap hint. */
const SHIM_VARIABLES_PATTERN =
  /import\('\.\.\/dist\/esm\/(?<target>[^']+)\.js'\)[\s\S]*?write\('(?<bin>[^:']+): build output not found; run `(?<hint>[^`]+)` first/;

const monorepoRoot = findMonorepoRoot(import.meta.dirname);

/**
 * Guards the hand-copied `bin` shims against drift. Each shim inlines the crash report of nmr-core's `reportCrash`,
 * because it runs before any build output loads, so every shim must keep the same body; the crash-report tool test
 * exercises that body through one of them.
 */
describe('every bin shim has the canonical body', () => {
  const shims = getWorkspacePackageDirs(monorepoRoot).flatMap(listShimFiles);

  it('finds shims to check', () => {
    expect(shims.length).toBeGreaterThan(1);
  });

  const [referenceShim] = shims;

  it.each(shims.map((shimPath) => [path.relative(monorepoRoot, shimPath), shimPath] as const))(
    '%s',
    (_label, shimPath) => {
      expect(referenceShim).toBeDefined();
      if (referenceShim === undefined) return;

      expect(normalizeShim(shimPath)).toBe(normalizeShim(referenceShim));
    },
  );
});

// region | Helpers

/** Lists the `.js` files in a package's `bin/` directory, or none when it lacks one. */
function listShimFiles(packageDir: string): string[] {
  const binDir = path.join(packageDir, 'bin');
  try {
    return readdirSync(binDir)
      .filter((name) => name.endsWith('.js'))
      .map((name) => path.join(binDir, name));
  } catch {
    return [];
  }
}

/** Returns a shim's text with its build entry, bin name, and bootstrap hint replaced by placeholders. */
function normalizeShim(shimPath: string): string {
  const text = readFileSync(shimPath, 'utf8');
  const variables = SHIM_VARIABLES_PATTERN.exec(text)?.groups;
  const { bin, hint, target } = variables ?? {};
  if (bin === undefined || hint === undefined || target === undefined) {
    throw new Error(`${path.relative(monorepoRoot, shimPath)} does not match the shim shape`);
  }
  return text
    .replaceAll(`../dist/esm/${target}.js`, '../dist/esm/<target>.js')
    .replaceAll(`${bin}: `, '<bin>: ')
    .replaceAll(`\`${hint}\``, '`<hint>`');
}

// endregion | Helpers
