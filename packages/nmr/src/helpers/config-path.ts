import path from 'node:path';

const CONFIG_DIR = '.config';
const CONFIG_FILENAME = 'nmr.config.ts';

/** The config's path relative to the directory holding it, for a message composed without one in hand. */
export const CONFIG_RELATIVE_PATH = path.join(CONFIG_DIR, CONFIG_FILENAME);

/**
 * Resolves the config-file path for a directory, whether that is the monorepo root or a package.
 * Callers that only need to know whether a config exists -- the build, which folds it into its cache digest -- go
 * through this rather than spelling the path again, so that the two cannot drift into hashing a file nothing reads.
 */
export function resolveConfigPath(baseDir: string): string {
  return path.join(baseDir, CONFIG_DIR, CONFIG_FILENAME);
}
