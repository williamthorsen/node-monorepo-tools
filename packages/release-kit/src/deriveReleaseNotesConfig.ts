import { DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_RELEASE_NOTES_CONFIG } from './defaults.ts';
import { resolveWorkTypes } from './loadConfig.ts';
import type { ReleaseKitConfig, ReleaseNotesConfig } from './types.ts';

export interface ResolvedReleaseNotesConfig {
  releaseNotes: ReleaseNotesConfig;
  changelogJsonOutputPath: string;
  /** Section titles in priority order, derived from the merged workTypes record. */
  sectionOrder: string[];
}

/** Derives the release-notes settings from a loaded config, falling back to the defaults for an absent one. */
export function deriveReleaseNotesConfig(config: ReleaseKitConfig | undefined): ResolvedReleaseNotesConfig {
  return {
    releaseNotes: {
      shouldInjectIntoReadme:
        config?.releaseNotes?.shouldInjectIntoReadme ?? DEFAULT_RELEASE_NOTES_CONFIG.shouldInjectIntoReadme,
    },
    changelogJsonOutputPath: config?.changelogJson?.outputPath ?? DEFAULT_CHANGELOG_JSON_CONFIG.outputPath,
    sectionOrder: deriveSectionOrder(resolveWorkTypes(config?.workTypes)),
  };
}

/** Extract section headers in declaration order from a merged workTypes record. */
export function deriveSectionOrder(workTypes: Record<string, { header: string }>): string[] {
  return Object.values(workTypes).map((entry) => entry.header);
}
