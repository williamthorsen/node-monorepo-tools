import { readFileSync } from 'node:fs';
import path from 'node:path';

import { findMonorepoRoot, getWorkspacePackageDirs } from '@williamthorsen/nmr/workspace';
import { describe, expect, it } from 'vitest';

import { isRecord } from '../packages/nmr-core/src/portable/isRecord.ts';

const NMR = '@williamthorsen/nmr';

/** nmr itself, and nmr-core, which nmr depends on and which therefore cannot depend on nmr. */
const EXEMPT = new Set([NMR, '@williamthorsen/nmr-core']);

const manifests = getWorkspacePackageDirs(findMonorepoRoot(import.meta.dirname)).map(readManifest);

/**
 * Guards the edge that orders nmr's build ahead of every package whose build runs nmr's bins. pnpm sorts a
 * recursive run by the workspace graph alone, so a package without the edge builds alongside nmr and can load
 * `packages/nmr/dist` while nmr is replacing it.
 */
describe('every workspace package that nmr builds declares nmr', () => {
  it('finds packages to check, nmr among them', () => {
    expect(manifests.map(({ name }) => name)).toContain(NMR);
  });

  it.each(manifests.filter(({ name }) => !EXEMPT.has(name)))('$name', ({ devDependencies }) => {
    expect(devDependencies[NMR]).toBe('workspace:*');
  });
});

// region | Helpers

interface Manifest {
  devDependencies: Record<string, unknown>;
  name: string;
}

/** Reads the name and devDependencies of the package in `dir`. */
function readManifest(dir: string): Manifest {
  const parsed: unknown = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (!isRecord(parsed) || typeof parsed['name'] !== 'string') {
    throw new Error(`${dir} does not contain a package.json that declares a name`);
  }
  const devDependencies = parsed['devDependencies'];

  return { devDependencies: isRecord(devDependencies) ? devDependencies : {}, name: parsed['name'] };
}

// endregion | Helpers
