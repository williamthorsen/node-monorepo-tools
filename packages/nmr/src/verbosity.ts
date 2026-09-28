import type { OutputConfig } from './types.ts';

/**
 * Environment variables that a known agent harness sets, whose presence selects quiet when every level above them
 * left the verbosity unset. `output.extraAgentEnvVars` extends the list. `ROVO_CLI` anticipates a rename of
 * `ROVODEV_CLI` that Rovo has signalled but not made.
 */
export const AGENT_ENV_VARS = ['CLAUDECODE', 'ROVODEV_CLI', 'ROVO_CLI'] as const;

/**
 * The points on the loudness ladder. Both are spelled out rather than leaving `full` implicit in the variable's
 * absence, so that a repo-level default is overridable from the environment in either direction.
 */
export const COMMAND_VERBOSITIES = ['full', 'quiet'] as const;

/**
 * Passes the resolved verbosity down the chain of spawned processes, so that `-q` applies to every process rather
 * than only the first. The pass key does not include it: It changes what a run prints and never what a command
 * concludes, so a quiet run can reuse a pass that a full run recorded.
 */
export const COMMAND_VERBOSITY_ENV_VAR = 'NMR_COMMAND_VERBOSITY';

/** How loudly nmr reports the output of the commands that it runs, which is never its own verdicts. */
export type CommandVerbosity = (typeof COMMAND_VERBOSITIES)[number];

/**
 * Renders the rejection of a value off the loudness ladder, naming where it was written. Because every source that
 * accepts a verbosity renders through this, the sources cannot come to name different ladders.
 */
export function formatVerbosityRejection(source: string, value: string): string {
  return `${source} is \`${value}\`, which is not one of: ${COMMAND_VERBOSITIES.join(', ')}`;
}

/** Narrows a raw value to a point on the loudness ladder. */
export function isCommandVerbosity(value: string): value is CommandVerbosity {
  const names: readonly string[] = COMMAND_VERBOSITIES;
  return names.includes(value);
}

/**
 * Reads the verbosity that the environment names. An unrecognized value is returned as an error, since a fallback
 * would pick a mode that nobody chose and hide a misspelling for the life of the shell.
 *
 * For an unset or empty variable, this returns a result without a verbosity rather than resolving to `full`, which
 * is what leaves the config and detection levels reachable: A floor written in here would outrank both of them.
 */
export function readVerbosityEnv(env: NodeJS.ProcessEnv): VerbosityRead {
  const rawValue = env[COMMAND_VERBOSITY_ENV_VAR];
  if (rawValue === undefined || rawValue === '') {
    return { ok: true };
  }

  if (!isCommandVerbosity(rawValue)) {
    return { ok: false, error: formatVerbosityRejection(COMMAND_VERBOSITY_ENV_VAR, rawValue) };
  }

  return { ok: true, verbosity: rawValue };
}

export interface ResolveVerbosityOptions {
  /**
   * Read for the detection level, and for that alone: The caller passes the variable that this module owns as
   * `envVerbosity`.
   */
  env: NodeJS.ProcessEnv;
  envVerbosity: CommandVerbosity | undefined;
  hasQuietFlag: boolean;
  output: OutputConfig | undefined;
}

/**
 * Resolves the verbosity at which this process runs: the flag, then the environment, then the repo's config, then
 * detection of a known agent harness, then `full`.
 *
 * Total by construction. The environment was validated as it was read and the config as it was loaded, so this does
 * not have any rejection left to report, and the whole ladder can be read in one place.
 */
export function resolveVerbosity(options: ResolveVerbosityOptions): CommandVerbosity {
  const { env, envVerbosity, hasQuietFlag, output } = options;

  if (hasQuietFlag) return 'quiet';
  if (envVerbosity !== undefined) return envVerbosity;
  if (output?.commandVerbosity !== undefined) return output.commandVerbosity;

  return hasAgentMarker(env, output?.extraAgentEnvVars) ? 'quiet' : 'full';
}

/** The verbosity that the environment names, if any, or the message naming why its value could not be read. */
export type VerbosityRead = { ok: true; verbosity?: CommandVerbosity } | { ok: false; error: string };

// region | Helpers

/**
 * Reports whether the environment contains a marker of a known agent harness. Keys on a variable's name and a
 * non-empty value: The value convention belongs to the harness, so only a name-only rule keeps working when a
 * harness changes it.
 */
function hasAgentMarker(env: NodeJS.ProcessEnv, extraNames: readonly string[] | undefined): boolean {
  const names = extraNames === undefined ? AGENT_ENV_VARS : [...AGENT_ENV_VARS, ...extraNames];

  return names.some((name) => {
    const value = env[name];
    return value !== undefined && value !== '';
  });
}

// endregion | Helpers
