import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AuditScope, ScopeConfig } from './types.ts';

/** Flat JSON shape that audit-ci expects as its config file. */
interface AuditCiFlatConfig {
  allowlist: string[];
  'show-not-found'?: boolean;
  [key: string]: boolean | string | string[] | undefined;
}

/** Map severity booleans from our config to audit-ci field names. */
const SEVERITY_FIELDS = ['critical', 'high', 'low', 'moderate'] as const;

/**
 * Transform a scope config into the flat JSON structure audit-ci expects.
 *
 * Extracts severity thresholds and flattens the typed allowlist to an array of ID strings.
 */
export function buildFlatConfig(scopeConfig: ScopeConfig): AuditCiFlatConfig {
  const flat: AuditCiFlatConfig = {
    allowlist: scopeConfig.allowlist.map((entry) => entry.id),
    'show-not-found': true,
  };

  for (const field of SEVERITY_FIELDS) {
    const value = scopeConfig[field];
    if (value !== undefined) {
      flat[field] = value;
    }
  }

  return flat;
}

/**
 * Generate the audit-ci config file for a scope and write it to disk.
 *
 * The output path is `{outDir}/audit-ci.{scope}.json`, where `outDir` is resolved
 * relative to `configDir`.
 */
export async function generateAuditCiConfig(
  scopeConfig: ScopeConfig,
  scope: AuditScope,
  configDir: string,
  outDir?: string,
): Promise<string> {
  const resolvedOutDir = outDir !== undefined ? path.resolve(configDir, outDir) : configDir;
  const outputPath = path.join(resolvedOutDir, `audit-ci.${scope}.json`);
  const flat = buildFlatConfig(scopeConfig);
  const content = JSON.stringify(flat, null, 2) + '\n';

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, 'utf8');

  return outputPath;
}
