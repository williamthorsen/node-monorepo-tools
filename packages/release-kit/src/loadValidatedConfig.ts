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
 * Loads and validates the config, reporting the problem and exiting 1 when it is unusable, so that a command
 * whose later work may never reach a loader still fails on a config that does.
 *
 * An absent default config returns cleanly, which is what keeps a repo that declares no config a supported state.
 * Reports problems but never warnings: the command's own later load stays the single place that emits those, so
 * a warning is not printed twice.
 *
 * The second load costs nothing: `import()` caches by URL and `validateConfig` is pure.
 */
export async function assertConfigUsable(stderrStyle: OutputStyle, configPath?: string): Promise<void> {
  const result = await loadValidatedConfig(configPath);
  if (result.status === 'invalid') {
    reportConfigProblem(result.problem, stderrStyle);
    process.exit(1);
  }
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
