import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { hasErrnoCode, UserError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { DEFAULT_CONFIG, type V11yCheckConfig, v11yCheckConfigSchema } from './types.ts';

/** Default config file path, relative to the working directory. */
export const DEFAULT_CONFIG_PATH = '.config/v11y-check.config.json';

/** Discriminates between a config loaded from a file and one built from defaults. */
export type ConfigSource = 'defaults' | 'file';

/** Result of loading config, including the source discriminator. */
export interface LoadConfigResult {
  config: V11yCheckConfig;
  configDir: string;
  configFilePath: string;
  configSource: ConfigSource;
}

/**
 * Loads and validates the v11y-check config from disk, falling back to defaults.
 *
 * When `configPath` is explicitly provided, the file must exist. When omitted,
 * the default path is tried; if absent, `DEFAULT_CONFIG` is returned.
 */
export async function loadConfig(configPath?: string, cwd?: string): Promise<LoadConfigResult> {
  const resolvedCwd = cwd ?? process.cwd();
  const filePath = path.resolve(resolvedCwd, configPath ?? DEFAULT_CONFIG_PATH);
  const configDir = path.dirname(filePath);

  if (configPath === undefined && !existsSync(filePath)) {
    return {
      config: DEFAULT_CONFIG,
      configDir,
      configFilePath: filePath,
      configSource: 'defaults',
    };
  }

  let rawContent: string;
  try {
    rawContent = await readFile(filePath, 'utf8');
  } catch (error: unknown) {
    if (hasErrnoCode(error, 'ENOENT') || hasErrnoCode(error, 'ENOTDIR')) {
      throw new UserError(
        `Config file not found: ${filePath}\nRun 'v11y init' to create it, or pass --config with the path of an existing file.`,
        { cause: error },
      );
    }
    throw new UserError(`Could not read config file ${filePath}: ${describeError(error)}`, { cause: error });
  }

  let parsedConfig: unknown;
  try {
    parsedConfig = JSON.parse(rawContent);
  } catch (error: unknown) {
    throw new UserError(`Config file is not valid JSON: ${filePath}: ${describeError(error)}`, { cause: error });
  }

  const result = v11yCheckConfigSchema.safeParse(parsedConfig);
  if (!result.success) {
    const issueText = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new UserError(`Invalid config in ${filePath}:\n${issueText}`);
  }

  return { config: result.data, configDir, configFilePath: filePath, configSource: 'file' };
}
