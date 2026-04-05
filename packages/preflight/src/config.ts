import { existsSync } from 'node:fs';
import path from 'node:path';

import { assertIsPreflightCollection } from './assertIsPreflightCollection.ts';
import { jitiImport } from './jitiImport.ts';
import { resolveCollectionExports } from './resolveCollectionExports.ts';
import type { PreflightCollection } from './types.ts';
import { validateCollection } from './validateCollection.ts';

/**
 * Load and validate a preflight collection file.
 *
 * Uses jiti to load TypeScript config files at runtime.
 */
export async function loadPreflightCollection(collectionPath: string): Promise<PreflightCollection> {
  const resolvedPath = path.resolve(process.cwd(), collectionPath);

  if (!existsSync(resolvedPath)) {
    if (collectionPath.startsWith('.preflight/collections/')) {
      const baseName = path.basename(collectionPath, '.ts');
      throw new Error(`Collection "${baseName}" not found. Run 'preflight init' to create one.`);
    }
    throw new Error(`Preflight collection not found: ${collectionPath}`);
  }

  const imported = await jitiImport(
    resolvedPath,
    'Uncompiled collections require the package to be installed as a project dependency. ' +
      "Alternatively, run 'preflight compile' to produce a self-contained bundle that does not need a local install.",
    'Collection file',
  );

  const resolved = resolveCollectionExports(imported);
  assertIsPreflightCollection(resolved);
  validateCollection(resolved);
  return resolved;
}
