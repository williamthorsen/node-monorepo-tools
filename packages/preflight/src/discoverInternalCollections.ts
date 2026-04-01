import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { assertIsPreflightCollection, isRecord } from './assertIsPreflightCollection.ts';
import { resolveCollectionExports } from './resolveCollectionExports.ts';
import type { PreflightCollection } from './types.ts';

/**
 * Discover and load all `.ts` collection files from a directory.
 *
 * Each file is loaded via jiti, validated as a collection, and returned.
 * Throws when the directory does not exist or contains no `.ts` files.
 */
export async function discoverInternalCollections(dirPath: string): Promise<PreflightCollection[]> {
  const resolvedDir = path.resolve(process.cwd(), dirPath);

  if (!existsSync(resolvedDir)) {
    throw new Error(`Collections directory not found: ${resolvedDir}`);
  }

  const entries = readdirSync(resolvedDir);
  const tsFiles = entries.filter((name) => name.endsWith('.ts')).sort();

  if (tsFiles.length === 0) {
    throw new Error(`No .ts collection files found in ${resolvedDir}`);
  }

  const { createJiti } = await import('jiti');
  const jiti = createJiti(import.meta.url);
  const collections: PreflightCollection[] = [];

  for (const fileName of tsFiles) {
    const filePath = path.join(resolvedDir, fileName);
    const imported: unknown = await jiti.import(filePath);

    if (!isRecord(imported)) {
      throw new Error(
        `${fileName}: collection file must export an object, got ${Array.isArray(imported) ? 'array' : typeof imported}`,
      );
    }

    let resolved: Record<string, unknown>;
    try {
      resolved = resolveCollectionExports(imported);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${fileName}: ${message}`);
    }

    try {
      assertIsPreflightCollection(resolved);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${fileName}: ${message}`);
    }

    collections.push(resolved);
  }

  return collections;
}
