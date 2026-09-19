import { type OutputStyle, printError, reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { CONFIG_FILE_PATH, loadConfig } from './loadConfig.ts';
import type { ReleaseKitConfig } from './types.ts';
import { validateConfig } from './validateConfig.ts';

/**
 * Outcome of loading and validating the consumer config file. `missing` is not reported
 * here — whether an absent config file is an error is the caller's call.
 *
 * `configFilePath` names the file the run read: the caller's `configPath`, or `CONFIG_FILE_PATH` when none was
 * given. It stays relative to the working directory, so a message or a generated artifact that splices it reads
 * the same on every machine.
 */
export type LoadValidatedConfigResult =
  | { status: 'invalid'; configFilePath: string }
  | { status: 'missing'; configFilePath: string }
  | { status: 'ok'; config: ReleaseKitConfig; configFilePath: string };

/**
 * Load the consumer config file and validate it against the shared schema, reporting load
 * failures and validation errors to stderr.
 *
 * `configPath` defaults to `CONFIG_FILE_PATH`. A named path that does not exist is a load failure, so it reports
 * as `invalid` rather than `missing`.
 */
export async function loadValidatedConfig(
  stderrStyle: OutputStyle,
  configPath?: string,
): Promise<LoadValidatedConfigResult> {
  const configFilePath = configPath ?? CONFIG_FILE_PATH;

  let raw: unknown;
  try {
    raw = await loadConfig(configPath);
  } catch (error: unknown) {
    const message = describeError(error);
    reportError(`Failed to load config: ${message}`);
    return { status: 'invalid', configFilePath };
  }

  if (raw === undefined) {
    return { status: 'missing', configFilePath };
  }

  const { config, errors } = validateConfig(raw);
  if (errors.length > 0) {
    process.stderr.write('Invalid config:\n');
    for (const err of errors) {
      printError(err, stderrStyle);
    }
    return { status: 'invalid', configFilePath };
  }

  return { status: 'ok', config, configFilePath };
}
