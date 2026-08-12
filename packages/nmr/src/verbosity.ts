import type { OutputConfig } from './types.ts';

/**
 * Environment variables a known agent harness sets, whose presence selects quiet when no level above them chose.
 * The identifiers belong to ecosystems nmr does not control and that rename, so `output.extraAgentEnvVars` extends
 * this list rather than a repo waiting for a release. `ROVO_CLI` anticipates a rename of `ROVODEV_CLI` that Rovo
 * has signalled but not made; a variable nobody sets never fires.
 */
export const AGENT_ENV_VARS = ['CLAUDECODE', 'ROVODEV_CLI', 'ROVO_CLI'] as const;

/**
 * The points on the loudness ladder. Both are spelled out rather than leaving `full` implicit in the variable's
 * absence, so a repo-level default is overridable from the environment in either direction.
 */
export const COMMAND_VERBOSITIES = ['full', 'quiet'] as const;

/**
 * Carries the resolved verbosity down the spawned chain, so `-q` reaches every process rather than the first.
 * Deliberately not a keyed variable: it changes what a run prints and never what a command concludes, so folding
 * it into the cache key would stop a quiet run from hitting a pass a loud one recorded.
 */
export const COMMAND_VERBOSITY_ENV_VAR = 'NMR_COMMAND_VERBOSITY';

/** How loudly nmr reports the output of the commands it runs, which is never its own verdicts. */
export type CommandVerbosity = (typeof COMMAND_VERBOSITIES)[number];

/**
 * Renders the rejection of a value off the loudness ladder, naming where it was written. Every source that accepts
 * a verbosity renders through this, so no two of them can come to name different ladders.
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
 * Reads the verbosity the environment names. An unrecognized value resolves to nothing at all, since falling back
 * would pick a mode nobody chose and hide a misspelling for the life of the shell.
 *
 * An unset or empty variable names no verbosity rather than resolving to `full`, which is what leaves the config
 * and detection levels reachable: a floor written in here would outrank both of them.
 */
export function readVerbosityEnv(env: NodeJS.ProcessEnv): VerbosityRead {
  const raw = env[COMMAND_VERBOSITY_ENV_VAR];
  if (raw === undefined || raw === '') {
    return { ok: true };
  }

  if (!isCommandVerbosity(raw)) {
    return { ok: false, error: formatVerbosityRejection(COMMAND_VERBOSITY_ENV_VAR, raw) };
  }

  return { ok: true, verbosity: raw };
}

export interface ResolveVerbosityOptions {
  /** Read for the detection level, and for that alone: the variable this module owns arrives as `envVerbosity`. */
  env: NodeJS.ProcessEnv;
  envVerbosity: CommandVerbosity | undefined;
  output: OutputConfig | undefined;
  quietFlag: boolean;
}

/**
 * Resolves the verbosity this process runs at: the flag, then the environment, then the repo's config, then
 * detection of a known agent harness, then `full`.
 *
 * Total by construction. The environment was validated as it was read and the config as it was loaded, so no
 * rejection is left for this to report and the whole ladder reads in one place.
 */
export function resolveVerbosity(options: ResolveVerbosityOptions): CommandVerbosity {
  const { env, envVerbosity, output, quietFlag } = options;

  if (quietFlag) return 'quiet';
  if (envVerbosity !== undefined) return envVerbosity;
  if (output?.commandVerbosity !== undefined) return output.commandVerbosity;

  return hasAgentMarker(env, output?.extraAgentEnvVars) ? 'quiet' : 'full';
}

/** The verbosity the environment names, if any, or the message naming why its value could not be read. */
export type VerbosityRead = { ok: true; verbosity?: CommandVerbosity } | { ok: false; error: string };

// region | Helpers

/**
 * Reports whether the environment carries a marker of a known agent harness. Keys on a variable's name and a
 * non-empty value: the value convention belongs to the harness, so only a name-only rule survives a harness
 * changing it.
 */
function hasAgentMarker(env: NodeJS.ProcessEnv, extraNames: readonly string[] | undefined): boolean {
  const names = extraNames === undefined ? AGENT_ENV_VARS : [...AGENT_ENV_VARS, ...extraNames];

  return names.some((name) => {
    const value = env[name];
    return value !== undefined && value !== '';
  });
}

// endregion | Helpers
