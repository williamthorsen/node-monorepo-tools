import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { AuditDepsConfig } from './types.ts';
import { auditDepsConfigSchema, DEFAULT_CONFIG } from './types.ts';

/** Default config file path, relative to the working directory. */
export const DEFAULT_CONFIG_PATH = '.config/audit-deps.config.json';

/** Discriminate between a config loaded from a file and one built from defaults. */
export type ConfigSource = 'defaults' | 'file';

/** Result of loading config, including the source discriminator. */
export interface LoadConfigResult {
  config: AuditDepsConfig;
  configDir: string;
  configFilePath: string;
  configSource: ConfigSource;
}

/**
 * Load and validate the audit-deps config from disk, falling back to defaults.
 *
 * When `configPath` is explicitly provided, the file must exist. When omitted,
 * the default path is tried; if absent, `DEFAULT_CONFIG` is returned.
 */
export async function loadConfig(configPath?: string, cwd?: string): Promise<LoadConfigResult> {
  const resolvedCwd = cwd ?? process.cwd();
  const filePath = path.resolve(resolvedCwd, configPath ?? DEFAULT_CONFIG_PATH);
  const configDir = path.dirname(filePath);

  // When no explicit path was provided and the default file doesn't exist, use defaults.
  if (configPath === undefined && !existsSync(filePath)) {
    return {
      config: DEFAULT_CONFIG,
      configDir,
      configFilePath: filePath,
      configSource: 'defaults',
    };
  }

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

  return { config: result.data, configDir, configFilePath: filePath, configSource: 'file' };
}
