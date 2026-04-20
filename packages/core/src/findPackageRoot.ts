import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Find the nearest ancestor directory containing `package.json`, starting from
 * the directory of the given `import.meta.url`.
 *
 * Useful for resolving bundled assets (presets, templates) relative to the
 * package root, regardless of the calling module's depth in the source or dist tree.
 */
export function findPackageRoot(fromUrl: string): string {
  let dir = dirname(fileURLToPath(fromUrl));
  while (!existsSync(resolve(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('Could not find package root from ' + fromUrl);
    }
    dir = parent;
  }
  return dir;
}
