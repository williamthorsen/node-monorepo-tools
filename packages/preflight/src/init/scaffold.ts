import type { WriteResult } from '@williamthorsen/node-monorepo-core';
import { writeFileWithCheck } from '@williamthorsen/node-monorepo-core';

import { preflightConfigTemplate } from './templates.ts';

const CONFIG_PATH = '.config/preflight.config.ts';

interface ScaffoldOptions {
  dryRun: boolean;
  force: boolean;
}

/** Scaffold the preflight config file. Returns a write result indicating what happened. */
export function scaffoldConfig({ dryRun, force }: ScaffoldOptions): WriteResult {
  return writeFileWithCheck(CONFIG_PATH, preflightConfigTemplate, { dryRun, overwrite: force });
}
