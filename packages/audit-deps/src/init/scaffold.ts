import type { WriteResult } from '@williamthorsen/node-monorepo-core';
import { writeFileWithCheck } from '@williamthorsen/node-monorepo-core';

import { auditDepsConfigTemplate } from './templates.ts';

const CONFIG_PATH = '.config/audit-deps.config.json';

interface ScaffoldOptions {
  dryRun: boolean;
  force: boolean;
}

interface ScaffoldResult {
  configResult: WriteResult;
}

/** Scaffold the audit-deps config file with sensible defaults. */
export function scaffoldConfig({ dryRun, force }: ScaffoldOptions): ScaffoldResult {
  const configResult = writeFileWithCheck(CONFIG_PATH, auditDepsConfigTemplate, { dryRun, overwrite: force });
  return { configResult };
}
