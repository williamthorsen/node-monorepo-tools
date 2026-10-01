import { DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_RELEASE_NOTES_CONFIG } from './defaults.ts';
import { resolveWorkTypes } from './loadConfig.ts';
import type { ReleaseKitConfig, ReleaseNotesConfig } from './types.ts';

export interface ResolvedReleaseNotesConfig {
  releaseNotes: ReleaseNotesConfig;
  changelogJsonOutputPath: string;
  /** Section titles in priority order, derived from the merged workTypes record. */
  sectionOrder: string[];
}

/**
 * Returns the header of a merged `workTypes` record's `deps` entry, which titles the synthetic propagation section.
 * Throws when the record lacks one, which `resolveWorkTypes` never produces.
 */
export function deriveDependenciesHeader(workTypes: Record<string, { header: string }>): string {
  const header = workTypes['deps']?.header;
  if (header === undefined) {
    throw new Error("Resolved work types do not contain a 'deps' entry");
  }
  return header;
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

/** Returns the section headers of a merged `workTypes` record, in declaration order. */
export function deriveSectionOrder(workTypes: Record<string, { header: string }>): string[] {
  return Object.values(workTypes).map((entry) => entry.header);
}
