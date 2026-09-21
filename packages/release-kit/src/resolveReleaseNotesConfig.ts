/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import type { OutputStyle } from '@williamthorsen/nmr-core';

import { DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_RELEASE_NOTES_CONFIG } from './defaults.ts';
import { resolveWorkTypes } from './loadConfig.ts';
import { loadValidatedConfig, reportConfigProblem, reportConfigWarnings } from './loadValidatedConfig.ts';
import type { ReleaseNotesConfig } from './types.ts';

export interface ResolvedReleaseNotesConfig {
  releaseNotes: ReleaseNotesConfig;
  changelogJsonOutputPath: string;
  /** Section titles in priority order, derived from the merged workTypes record. */
  sectionOrder: string[];
}

export interface ResolveReleaseNotesConfigOptions {
  /** Config file to read, relative to the working directory. Defaults to `CONFIG_FILE_PATH`. */
  configPath?: string;
}

/**
 * Loads and validates the release-kit config, resolving the release-notes settings it carries.
 *
 * An unusable config reports to stderr and calls `process.exit(1)`, whether the file failed to load or failed
 * validation, and whether it was named by the caller or the default one. Both callers are CLI commands whose
 * whole behavior depends on the resolved config, so neither could proceed on derived defaults without silently
 * dropping a configured `releaseNotes.shouldInjectIntoReadme`, `changelogJson.outputPath`, or `workTypes`.
 * An absent default config is a supported state and resolves to the defaults.
 */
export async function resolveReleaseNotesConfig(
  stderrStyle: OutputStyle,
  options: ResolveReleaseNotesConfigOptions = {},
): Promise<ResolvedReleaseNotesConfig> {
  const result = await loadValidatedConfig(options.configPath);

  if (result.status === 'invalid') {
    reportConfigProblem(result.problem, stderrStyle);
    process.exit(1);
  }

  if (result.status === 'missing') {
    return {
      releaseNotes: { ...DEFAULT_RELEASE_NOTES_CONFIG },
      changelogJsonOutputPath: DEFAULT_CHANGELOG_JSON_CONFIG.outputPath,
      sectionOrder: deriveSectionOrder(resolveWorkTypes()),
    };
  }

  reportConfigWarnings(result.warnings, stderrStyle);

  const { config } = result;
  return {
    releaseNotes: {
      shouldInjectIntoReadme:
        config.releaseNotes?.shouldInjectIntoReadme ?? DEFAULT_RELEASE_NOTES_CONFIG.shouldInjectIntoReadme,
    },
    changelogJsonOutputPath: config.changelogJson?.outputPath ?? DEFAULT_CHANGELOG_JSON_CONFIG.outputPath,
    sectionOrder: deriveSectionOrder(resolveWorkTypes(config.workTypes)),
  };
}

/** Extract section headers in declaration order from a merged workTypes record. */
export function deriveSectionOrder(workTypes: Record<string, { header: string }>): string[] {
  return Object.values(workTypes).map((entry) => entry.header);
}
