/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_RELEASE_NOTES_CONFIG } from './defaults.ts';
import { loadConfig, resolveWorkTypes } from './loadConfig.ts';
import type { ReleaseNotesConfig } from './types.ts';
import { validateConfig } from './validateConfig.ts';

export interface ResolvedReleaseNotesConfig {
  releaseNotes: ReleaseNotesConfig;
  changelogJsonOutputPath: string;
  /** Section titles in priority order, derived from the merged workTypes record. */
  sectionOrder: string[];
}

export interface ResolveReleaseNotesConfigOptions {
  /**
   * When `true`, a `loadConfig()` rejection causes `process.exit(1)` rather than a fallback to
   * defaults. Use from CLI commands whose entire behavior depends on the resolved config (e.g.
   * `create-github-release`), so a corrupt or unreadable config cannot silently send the command
   * to the wrong changelog path.
   */
  strictLoad?: boolean;
}

/**
 * Load and validate the release-kit config.
 *
 * By default, falls back to defaults when `loadConfig()` rejects (legacy publish behavior).
 * When `strictLoad` is `true`, a load failure prints an error and calls `process.exit(1)`.
 */
export async function resolveReleaseNotesConfig(
  options: ResolveReleaseNotesConfigOptions = {},
): Promise<ResolvedReleaseNotesConfig> {
  const { strictLoad = false } = options;
  let rawConfig: unknown;
  try {
    rawConfig = await loadConfig();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (strictLoad) {
      console.error(`Error: failed to load config: ${message}`);
      process.exit(1);
    }
    console.warn(`Warning: failed to load config; using defaults: ${message}`);
  }

  if (rawConfig === undefined) {
    return {
      releaseNotes: { ...DEFAULT_RELEASE_NOTES_CONFIG },
      changelogJsonOutputPath: DEFAULT_CHANGELOG_JSON_CONFIG.outputPath,
      sectionOrder: deriveSectionOrder(resolveWorkTypes()),
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
    sectionOrder: deriveSectionOrder(resolveWorkTypes(config.workTypes)),
  };
}

/** Extract section headers in declaration order from a merged workTypes record. */
function deriveSectionOrder(workTypes: Record<string, { header: string }>): string[] {
  return Object.values(workTypes).map((entry) => entry.header);
}
