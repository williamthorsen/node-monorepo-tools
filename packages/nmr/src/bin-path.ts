import path from 'node:path';

/**
 * Returns the environment in which a scope's commands run: Its `PATH` leads with the anchor's `node_modules/.bin`
 * and then the monorepo root's, as under `pnpm run`, followed by the inherited `PATH`.
 *
 * A directory that the inherited `PATH` already contains is left where it is, so that an nmr run nested in another
 * does not lengthen `PATH`.
 */
export function prependBinDirs(options: {
  anchorDir: string;
  env: NodeJS.ProcessEnv;
  monorepoRoot: string;
}): NodeJS.ProcessEnv {
  const { anchorDir, env, monorepoRoot } = options;

  const inherited = env['PATH'] ?? '';
  const seen = new Set(
    inherited
      .split(path.delimiter)
      .filter((entry) => entry !== '')
      .map((entry) => path.resolve(entry)),
  );

  const additions: string[] = [];
  for (const dir of [anchorDir, monorepoRoot]) {
    const binDir = path.resolve(dir, 'node_modules', '.bin');
    if (!seen.has(binDir)) {
      seen.add(binDir);
      additions.push(binDir);
    }
  }

  if (additions.length === 0) {
    return env;
  }

  return { ...env, PATH: [...additions, ...(inherited === '' ? [] : [inherited])].join(path.delimiter) };
}
