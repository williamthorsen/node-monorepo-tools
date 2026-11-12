/**
 * The values that an on/off environment switch accepts. An unset or empty variable is off as well, so that a shell
 * that clears a switch keeps working.
 */
export const ENV_SWITCH_VALUES = ['0', '1'] as const;

/**
 * Reports whether a switch is on. A value that the switch does not accept reads as off: The entry point of each bin
 * rejects one before any command runs, through `readEnvSwitch`.
 */
export function isEnvSwitchOn(env: NodeJS.ProcessEnv, name: string): boolean {
  return env[name] === '1';
}

/**
 * Reads an on/off switch from the environment. An unrecognized value is returned as an error, since a fallback to
 * off would hide a misspelling, such as `true`, for the life of the shell.
 */
export function readEnvSwitch(env: NodeJS.ProcessEnv, name: string): EnvSwitchRead {
  const rawValue = env[name];
  if (rawValue === undefined || rawValue === '' || rawValue === '0') {
    return { ok: true, isOn: false };
  }
  if (rawValue === '1') {
    return { ok: true, isOn: true };
  }

  return {
    ok: false,
    error: `${name} is \`${rawValue}\`, which is not one of: ${ENV_SWITCH_VALUES.join(', ')} (unset or empty is off)`,
  };
}

/** Reads each named switch, and returns the message naming the first one whose value it does not accept. */
export function readEnvSwitches(env: NodeJS.ProcessEnv, names: readonly string[]): string | undefined {
  for (const name of names) {
    const read = readEnvSwitch(env, name);
    if (!read.ok) {
      return read.error;
    }
  }

  return undefined;
}

/** Whether a switch is on, or the message naming why its value could not be read. */
export type EnvSwitchRead = { ok: true; isOn: boolean } | { ok: false; error: string };
