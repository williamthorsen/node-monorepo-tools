import { createConfigLoader } from 'unconfig';

/**
 * Returns the `packageMaturityPeriod` that the taze config governing `cwd` declares, unvalidated, or `undefined`
 * when no config file is found.
 *
 * The sources, the upward search, and the `default` unwrapping mirror `resolveConfig` and `normalizeConfig` in
 * taze 21.3.0, so that this reads the same file that taze reads. Throws when the file fails to load.
 */
export async function loadPackageMaturityPeriod(cwd: string): Promise<unknown> {
  const { config, sources } = await createConfigLoader<unknown>({
    sources: [{ files: ['taze.config'] }, { files: ['.tazerc'], extensions: ['json', ''] }],
    cwd,
    merge: false,
  }).load();
  if (sources.length === 0) return undefined;

  const options = isRecord(config) && 'default' in config ? config['default'] : config;
  return isRecord(options) ? options['packageMaturityPeriod'] : undefined;
}

// region | Helpers

/** Reports whether `value` is a non-null object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// endregion | Helpers
