import path from 'node:path';

/**
 * Returns an XDG base directory, resolved from `env` alone: the variable's value when that is an absolute path, as the
 * XDG base-directory spec requires, otherwise `homeSubdir` under `HOME`. Returns `undefined` when `env` names neither.
 */
export function resolveXdgBaseDir(
  env: NodeJS.ProcessEnv,
  variable: 'XDG_CACHE_HOME' | 'XDG_CONFIG_HOME',
  homeSubdir: string,
): string | undefined {
  const baseDir = env[variable];
  if (baseDir !== undefined && path.isAbsolute(baseDir)) {
    return baseDir;
  }

  const home = env['HOME'];
  if (home !== undefined && path.isAbsolute(home)) {
    return path.join(home, homeSubdir);
  }

  return undefined;
}
