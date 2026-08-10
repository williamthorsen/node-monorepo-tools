/**
 * Carries the resolved verbosity down the spawned chain, so `-q` reaches every process rather than the first.
 * Deliberately not a keyed variable: it changes what a run prints and never what a command concludes, so folding
 * it into the cache key would stop a quiet run from hitting a pass a loud one recorded.
 */
export const COMMAND_VERBOSITY_ENV_VAR = 'NMR_COMMAND_VERBOSITY';

/**
 * The points on the loudness ladder. Both are spelled out rather than leaving `full` implicit in the variable's
 * absence, so a repo-level default is overridable from the environment in either direction.
 */
export const COMMAND_VERBOSITIES = ['full', 'quiet'] as const;

/** How loudly nmr reports the output of the commands it runs, which is never its own verdicts. */
export type CommandVerbosity = (typeof COMMAND_VERBOSITIES)[number];

/** The verbosity this process runs at, or the message naming why an inherited value could not be read. */
export type VerbosityResolution = { ok: true; verbosity: CommandVerbosity } | { ok: false; error: string };

/**
 * Resolves the verbosity this process runs at. `-q` outranks an inherited value, which outranks the `full`
 * default; an unrecognized inherited value resolves to nothing at all, since falling back would pick a mode
 * nobody chose and hide a misspelling for the life of the shell.
 */
export function resolveVerbosity(env: NodeJS.ProcessEnv, quietFlag: boolean): VerbosityResolution {
  const raw = env[COMMAND_VERBOSITY_ENV_VAR];
  const inherited = raw === undefined || raw === '' ? 'full' : raw;

  if (!isCommandVerbosity(inherited)) {
    return {
      ok: false,
      error: `${COMMAND_VERBOSITY_ENV_VAR} is \`${inherited}\`, which is not one of: ${COMMAND_VERBOSITIES.join(', ')}`,
    };
  }

  return { ok: true, verbosity: quietFlag ? 'quiet' : inherited };
}

// region | Helpers

/** Narrows a raw environment value to a point on the loudness ladder. */
function isCommandVerbosity(value: string): value is CommandVerbosity {
  return COMMAND_VERBOSITIES.some((candidate) => candidate === value);
}

// endregion | Helpers
