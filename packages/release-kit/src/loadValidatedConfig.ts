/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { formatStatusLine, type OutputStyle, printError, reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { CONFIG_FILE_PATH, loadConfig } from './loadConfig.ts';
import type { ReleaseKitConfig } from './types.ts';
import { validateConfig } from './validateConfig.ts';

/**
 * Why a config file could not be used: the import threw, or the contents failed the schema.
 *
 * The distinction exists so that a caller can render the two differently. Every caller aborts on either.
 */
export type ConfigProblem = { kind: 'load'; message: string } | { kind: 'validation'; errors: string[] };

/**
 * Outcome of loading and validating the consumer config file. `missing` is not an error
 * here — whether an absent config file is one is the caller's call.
 *
 * `configFilePath` names the file the run read: the caller's `configPath`, or `CONFIG_FILE_PATH` when none was
 * given. It stays relative to the working directory, so a message or a generated artifact that splices it reads
 * the same on every machine.
 */
export type LoadValidatedConfigResult =
  | { status: 'invalid'; configFilePath: string; problem: ConfigProblem }
  | { status: 'missing'; configFilePath: string }
  | { status: 'ok'; config: ReleaseKitConfig; configFilePath: string; warnings: string[] };

/**
 * Loads the consumer config file and validates it against the shared schema, returning the outcome.
 *
 * Writes nothing to any stream: the caller picks the sink, which is what lets a command that must stay silent
 * reuse this loader. `reportConfigProblem` and `reportConfigWarnings` render the stderr form.
 *
 * `configPath` defaults to `CONFIG_FILE_PATH`. A named path that does not exist is a load failure, so it reports
 * as `invalid` rather than `missing`.
 */
export async function loadValidatedConfig(configPath?: string): Promise<LoadValidatedConfigResult> {
  const configFilePath = configPath ?? CONFIG_FILE_PATH;

  let raw: unknown;
  try {
    raw = await loadConfig(configPath);
  } catch (error: unknown) {
    return { status: 'invalid', configFilePath, problem: { kind: 'load', message: describeError(error) } };
  }

  if (raw === undefined) {
    return { status: 'missing', configFilePath };
  }

  const { config, errors, warnings } = validateConfig(raw);
  if (errors.length > 0) {
    return { status: 'invalid', configFilePath, problem: { kind: 'validation', errors } };
  }

  return { status: 'ok', config, configFilePath, warnings };
}

/**
 * Loads and validates the config for a CLI command, returning it, or `undefined` when no default config exists.
 *
 * An unusable config reports to stderr and exits 1, whether the file failed to load or failed validation, and
 * whether it was named by the caller or the default one. Validation warnings print to stderr.
 */
export async function loadUsableConfig(
  stderrStyle: OutputStyle,
  configPath?: string,
): Promise<ReleaseKitConfig | undefined> {
  const result = await loadValidatedConfig(configPath);
  if (result.status === 'invalid') {
    reportConfigProblem(result.problem, stderrStyle);
    process.exit(1);
  }

  if (result.status === 'missing') {
    return undefined;
  }

  reportConfigWarnings(result.warnings, stderrStyle);
  return result.config;
}

/** Writes a config problem to stderr in the form every CLI command uses. */
export function reportConfigProblem(problem: ConfigProblem, stderrStyle: OutputStyle): void {
  if (problem.kind === 'load') {
    reportError(`Failed to load config: ${problem.message}`);
    return;
  }

  process.stderr.write('Invalid config:\n');
  for (const error of problem.errors) {
    printError(error, stderrStyle);
  }
}

/** Writes validation warnings to stderr as indented status lines. */
export function reportConfigWarnings(warnings: readonly string[], stderrStyle: OutputStyle): void {
  for (const warning of warnings) {
    console.warn(`  ${formatStatusLine(stderrStyle, 'warning', warning)}`);
  }
}
