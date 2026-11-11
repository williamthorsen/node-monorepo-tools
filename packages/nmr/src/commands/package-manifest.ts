import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { hasErrnoCode } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

/** The fix for a broken lookup, whose cause can name the manifest of the resolving package as well as the tool's. */
export const BROKEN_MANIFEST_FIX = 'Repair that manifest, or reinstall the package that contains it.';

/**
 * Looks up the manifest of `packageName` as `require` from `parent` resolves it, a file path or a file URL.
 *
 * Only `MODULE_NOT_FOUND` means that the package is absent: Node rejects an installed package whose manifest is
 * malformed or unreadable with another code, and the message of that error, which `cause` repeats, names the
 * manifest at fault. A failure to read or parse the manifest after resolution prefixes `cause` with its path.
 */
export function findPackageManifest(parent: string, packageName: string): ManifestLookup {
  let manifestPath: string;
  try {
    manifestPath = createRequire(parent).resolve(`${packageName}/package.json`);
  } catch (error) {
    if (hasErrnoCode(error, 'MODULE_NOT_FOUND')) return { kind: 'absent' };
    return { kind: 'broken', cause: describeError(error) };
  }

  try {
    // Node accepts a manifest that starts with a byte-order mark, which `JSON.parse` rejects.
    const source = readFileSync(manifestPath, 'utf8').replace(/^\u{FEFF}/u, '');
    return { kind: 'found', manifestPath, manifest: JSON.parse(source) };
  } catch (error) {
    return { kind: 'broken', cause: `${manifestPath}: ${describeError(error)}` };
  }
}

/** What a lookup of a package's manifest found: the parsed manifest, no installed package, or a broken one. */
export type ManifestLookup =
  { kind: 'found'; manifestPath: string; manifest: unknown } | { kind: 'absent' } | { kind: 'broken'; cause: string };
