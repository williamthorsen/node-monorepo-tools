import { existsSync } from 'node:fs';
import path from 'node:path';

import { assertIsPreflightCollection } from './assertIsPreflightCollection.ts';
import { isRecord } from './isRecord.ts';
import { resolveCollectionExports } from './resolveCollectionExports.ts';
import type { PreflightChecklist, PreflightCollection, PreflightConfig, PreflightStagedChecklist } from './types.ts';
import { validateCollection } from './validateCollection.ts';

/**
 * The legacy default collection file path, resolved relative to `process.cwd()`.
 *
 * Retained for backward compatibility with repos that use the single-file collection pattern.
 * New repos should use `.config/preflight/collections/default.ts` instead.
 */
export const COLLECTION_FILE_PATH = '.config/preflight.config.ts';

/** Type-safe identity function for defining repo-level preflight settings. */
export function definePreflightConfig(config: PreflightConfig): PreflightConfig {
  return config;
}

/** Type-safe identity function for defining a preflight collection in a config file. */
export function definePreflightCollection(collection: PreflightCollection): PreflightCollection {
  return collection;
}

/** Type-safe identity function for defining an array of checklists in a config file. */
export function defineChecklists(
  checklists: Array<PreflightChecklist | PreflightStagedChecklist>,
): Array<PreflightChecklist | PreflightStagedChecklist> {
  return checklists;
}

/** Type-safe identity function for defining a flat checklist. */
export function definePreflightChecklist(checklist: PreflightChecklist): PreflightChecklist {
  return checklist;
}

/** Type-safe identity function for defining a staged checklist. */
export function definePreflightStagedChecklist(checklist: PreflightStagedChecklist): PreflightStagedChecklist {
  return checklist;
}

/**
 * Load and validate a preflight collection file.
 *
 * Falls back to the legacy path `.config/preflight.config.ts` when no path is provided.
 * Uses jiti to load TypeScript config files at runtime.
 */
export async function loadPreflightCollection(collectionPath?: string): Promise<PreflightCollection> {
  const resolvedPath = path.resolve(process.cwd(), collectionPath ?? COLLECTION_FILE_PATH);

  if (!existsSync(resolvedPath)) {
    if (collectionPath?.startsWith('.config/preflight/collections/')) {
      const baseName = path.basename(collectionPath, '.ts');
      throw new Error(`Collection "${baseName}" not found. Run 'preflight init' to create one.`);
    }
    throw new Error(`Preflight collection not found: ${resolvedPath}`);
  }

  const { createJiti } = await import('jiti');
  const jiti = createJiti(import.meta.url);
  const imported: unknown = await jiti.import(resolvedPath);

  if (!isRecord(imported)) {
    throw new Error(
      `Collection file must export an object, got ${Array.isArray(imported) ? 'array' : typeof imported}`,
    );
  }

  const resolved = resolveCollectionExports(imported);
  assertIsPreflightCollection(resolved);
  validateCollection(resolved);
  return resolved;
}
