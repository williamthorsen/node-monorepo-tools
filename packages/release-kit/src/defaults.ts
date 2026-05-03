import type { ChangelogJsonConfig, ReleaseNotesConfig, VersionPatterns, WorkTypeConfig } from './types.ts';
import { WORK_TYPES_DATA } from './workTypesData.ts';

/** Re-export the runtime taxonomy so consumers don't have to depend on `workTypesData.ts` directly. */
export type { WorkTypesData } from './workTypesData.ts';
export { WORK_TYPES_DATA } from './workTypesData.ts';

/**
 * Compose the rendered section heading for a work-type entry as `${emoji} ${label}`.
 *
 * Single-sourced here so callers (DEFAULT_WORK_TYPES derivation, devOnlySections
 * derivation, cliff-template drift comparison) cannot disagree on the composition rule.
 */
export function composeHeader(entry: { emoji: string; label: string }): string {
  return `${entry.emoji} ${entry.label}`;
}

/** Tier names treated as dev-only (not surfaced in public release notes). */
const DEV_ONLY_TIERS = new Set(['Internal', 'Process']);

/** Derive `DEFAULT_WORK_TYPES` from the loaded work-types data in canonical order. */
function deriveDefaultWorkTypes(): Record<string, WorkTypeConfig> {
  const result: Record<string, WorkTypeConfig> = {};
  for (const entry of WORK_TYPES_DATA.types) {
    const config: WorkTypeConfig = {
      header: composeHeader(entry),
    };
    if (entry.aliases.length > 0) {
      config.aliases = [...entry.aliases];
    }
    result[entry.key] = config;
  }
  return result;
}

/** Derive the dev-only section list from the loaded data, skipping `excludedFromChangelog` entries. */
function deriveDevOnlySections(): string[] {
  const sections: string[] = [];
  for (const entry of WORK_TYPES_DATA.types) {
    if (!DEV_ONLY_TIERS.has(entry.tier)) {
      continue;
    }
    if (entry.excludedFromChangelog === true) {
      continue;
    }
    sections.push(composeHeader(entry));
  }
  return sections;
}

/** Derive the per-type breaking-policy lookup from the loaded data. */
function deriveBreakingPolicies(): Record<string, 'forbidden' | 'optional' | 'required'> {
  const result: Record<string, 'forbidden' | 'optional' | 'required'> = {};
  for (const entry of WORK_TYPES_DATA.types) {
    result[entry.key] = entry.breakingPolicy;
  }
  return result;
}

/**
 * Default work types ordered by canonical priority.
 *
 * Derived from `work-types.json` (the canonical SSOT, mirrored at runtime by
 * `workTypesData.ts`). To change the taxonomy, edit `work-types.json` and update
 * `workTypesData.ts` to match — a drift test enforces lockstep.
 */
export const DEFAULT_WORK_TYPES: Record<string, WorkTypeConfig> = deriveDefaultWorkTypes();

/**
 * Per-canonical-type breaking-policy lookup derived from the canonical taxonomy.
 *
 * Pass this to `parseCommitMessage` (or an equivalent caller) so the parser knows which
 * types tolerate `!` and which trigger a policy-violation warning. Missing entries default
 * to `'optional'` to preserve back-compat for consumers that supply custom work-types.
 */
export const DEFAULT_BREAKING_POLICIES: Record<string, 'forbidden' | 'optional' | 'required'> =
  deriveBreakingPolicies();

/** Default version bump patterns. */
export const DEFAULT_VERSION_PATTERNS: VersionPatterns = {
  major: ['!'],
  minor: ['feat'],
};

/** Default configuration for structured changelog JSON generation. */
export const DEFAULT_CHANGELOG_JSON_CONFIG: ChangelogJsonConfig = {
  enabled: true,
  outputPath: '.meta/changelog.json',
  devOnlySections: deriveDevOnlySections(),
};

/** Default configuration for release notes consumption. */
export const DEFAULT_RELEASE_NOTES_CONFIG: ReleaseNotesConfig = {
  shouldInjectIntoReadme: false,
};

/** Default tag prefix for project-level releases. */
export const DEFAULT_PROJECT_TAG_PREFIX = 'v';
