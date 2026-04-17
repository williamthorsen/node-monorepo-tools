import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AuditScope, ScopeConfig } from './types.ts';

/** Flat JSON shape that audit-ci expects as its config file. */
interface AuditCiFlatConfig {
  allowlist: string[];
  'show-not-found'?: boolean;
  [key: string]: boolean | string | string[] | undefined;
}

/**
 * Transform a scope config into the flat JSON structure audit-ci expects.
 *
 * Translates `severityThreshold` to the corresponding audit-ci boolean and
 * flattens the typed allowlist to an array of ID strings.
 */
export function buildFlatConfig(scopeConfig: ScopeConfig): AuditCiFlatConfig {
  const flat: AuditCiFlatConfig = {
    allowlist: scopeConfig.allowlist.map((entry) => entry.id),
    'show-not-found': true,
  };

  if (scopeConfig.severityThreshold !== undefined) {
    flat[scopeConfig.severityThreshold] = true;
  }

  return flat;
}

/**
 * Generate the audit-ci config file for a scope and write it to disk.
 *
 * The output path is `{outputDir}/audit-ci.{scope}.json`.
 */
export async function generateAuditCiConfig(
  scopeConfig: ScopeConfig,
  scope: AuditScope,
  outputDir: string,
): Promise<string> {
  const outputPath = path.join(outputDir, `audit-ci.${scope}.json`);
  const flat = buildFlatConfig(scopeConfig);
  const content = JSON.stringify(flat, null, 2) + '\n';

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, 'utf8');

  return outputPath;
}
