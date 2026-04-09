import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { AuditDepsConfig } from './types.ts';
import { auditDepsConfigSchema } from './types.ts';

/** Default config file path, relative to the working directory. */
export const DEFAULT_CONFIG_PATH = '.config/audit-deps.config.json';

/**
 * Load and validate the audit-deps config from disk.
 *
 * Resolves the config path against `cwd`. Throws on missing file or validation failure.
 */
export async function loadConfig(
  configPath?: string,
  cwd?: string,
): Promise<{
  config: AuditDepsConfig;
  configDir: string;
  configFilePath: string;
}> {
  const resolvedCwd = cwd ?? process.cwd();
  const filePath = path.resolve(resolvedCwd, configPath ?? DEFAULT_CONFIG_PATH);
  const configDir = path.dirname(filePath);

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    throw new Error(`Config file not found: ${filePath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Config file is not valid JSON: ${filePath}`);
  }

  const result = auditDepsConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid config in ${filePath}:\n${issues}`);
  }

  return { config: result.data, configDir, configFilePath: filePath };
}
