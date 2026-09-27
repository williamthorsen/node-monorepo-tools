import path from 'node:path';

/**
 * Resolves a `--config` value against the directory from which `release-kit` was invoked, which differs from the
 * working directory once the process has moved to the repo root.
 *
 * Returns `undefined` when the flag is absent, so that `loadConfig` falls back to the default path under the root.
 */
export function resolveConfigFlag(config: string | undefined, invocationDir: string): string | undefined {
  return config === undefined ? undefined : path.resolve(invocationDir, config);
}
