import type { HostEnv } from './types.ts';

/** Returns the value of an environment variable, treating an empty string as unset. */
export function readEnv(env: HostEnv, key: string): string | undefined {
  const value = env[key];
  return value === undefined || value.length === 0 ? undefined : value;
}
