import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { findPackageRoot } from './findPackageRoot.js';

/**
 * Read the `version` field from the nearest ancestor `package.json`, starting
 * from the directory of the given `import.meta.url`.
 *
 * Composes `findPackageRoot` with a `package.json` read so callers get a
 * depth-agnostic version lookup that works in source layouts (`src/...`),
 * compiled layouts (`dist/esm/...`), and consumer layouts (npm-installed,
 * `npx`).
 *
 * Throws if the located `package.json` lacks a string `version` field.
 * Propagates `findPackageRoot`'s own error when no ancestor `package.json`
 * exists.
 */
export function readPackageVersion(fromUrl: string): string {
  const root = findPackageRoot(fromUrl);
  const packageJsonPath = resolve(root, 'package.json');
  const raw: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  if (typeof raw !== 'object' || raw === null || !('version' in raw) || typeof raw.version !== 'string') {
    throw new Error(`No string "version" field in ${packageJsonPath}`);
  }
  return raw.version;
}
