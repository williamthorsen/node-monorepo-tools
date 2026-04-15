/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_RELEASE_NOTES_CONFIG } from './defaults.ts';
import { loadConfig } from './loadConfig.ts';
import type { ReleaseNotesConfig } from './types.ts';
import { validateConfig } from './validateConfig.ts';

export interface ResolvedReleaseNotesConfig {
  releaseNotes: ReleaseNotesConfig;
  changelogJsonOutputPath: string;
}

/** Load and validate the release-kit config, falling back to defaults on load failure. */
export async function resolveReleaseNotesConfig(): Promise<ResolvedReleaseNotesConfig> {
  let rawConfig: unknown;
  try {
    rawConfig = await loadConfig();
  } catch (error: unknown) {
    console.warn(
      `Warning: failed to load config; using defaults: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (rawConfig === undefined) {
    return {
      releaseNotes: { ...DEFAULT_RELEASE_NOTES_CONFIG },
      changelogJsonOutputPath: DEFAULT_CHANGELOG_JSON_CONFIG.outputPath,
    };
  }

  const { config, errors, warnings } = validateConfig(rawConfig);
  if (errors.length > 0) {
    console.error('Invalid config:');
    for (const err of errors) {
      console.error(`  ❌ ${err}`);
    }
    process.exit(1);
  }
  for (const warning of warnings) {
    console.warn(`  ⚠️  ${warning}`);
  }

  return {
    releaseNotes: { ...DEFAULT_RELEASE_NOTES_CONFIG, ...config.releaseNotes },
    changelogJsonOutputPath: config.changelogJson?.outputPath ?? DEFAULT_CHANGELOG_JSON_CONFIG.outputPath,
  };
}
