import { reportError } from '@williamthorsen/nmr-core';

import { loadConfig } from './loadConfig.ts';
import type { ReleaseKitConfig } from './types.ts';
import { validateConfig } from './validateConfig.ts';

/**
 * Outcome of loading and validating the consumer config file. `missing` is not reported
 * here — whether an absent config file is an error is the caller's call.
 */
export type LoadValidatedConfigResult =
  { status: 'invalid' } | { status: 'missing' } | { status: 'ok'; config: ReleaseKitConfig };

/**
 * Load `.config/release-kit.config.ts` and validate it against the shared schema,
 * reporting load failures and validation errors to stderr.
 */
export async function loadValidatedConfig(): Promise<LoadValidatedConfigResult> {
  let raw: unknown;
  try {
    raw = await loadConfig();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    reportError(`Failed to load config: ${message}`);
    return { status: 'invalid' };
  }

  if (raw === undefined) {
    return { status: 'missing' };
  }

  const { config, errors } = validateConfig(raw);
  if (errors.length > 0) {
    process.stderr.write('Invalid config:\n');
    for (const err of errors) {
      process.stderr.write(`  ❌ ${err}\n`);
    }
    return { status: 'invalid' };
  }

  return { status: 'ok', config };
}
