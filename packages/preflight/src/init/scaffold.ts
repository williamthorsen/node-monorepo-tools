import type { WriteResult } from '@williamthorsen/node-monorepo-core';
import { writeFileWithCheck } from '@williamthorsen/node-monorepo-core';

import { preflightCollectionTemplate, preflightConfigTemplate } from './templates.ts';

const CONFIG_PATH = '.config/preflight.config.ts';
const COLLECTION_PATH = '.preflight/collections/default.ts';

interface ScaffoldOptions {
  dryRun: boolean;
  force: boolean;
}

interface ScaffoldResult {
  configResult: WriteResult;
  collectionResult: WriteResult;
}

/** Scaffold the preflight config and starter collection files. */
export function scaffoldConfig({ dryRun, force }: ScaffoldOptions): ScaffoldResult {
  const configResult = writeFileWithCheck(CONFIG_PATH, preflightConfigTemplate, { dryRun, overwrite: force });
  const collectionResult = writeFileWithCheck(COLLECTION_PATH, preflightCollectionTemplate, {
    dryRun,
    overwrite: force,
  });
  return { configResult, collectionResult };
}
