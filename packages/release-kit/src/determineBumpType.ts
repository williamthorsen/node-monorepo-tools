import { DEFAULT_VERSION_PATTERNS } from './defaults.ts';
import type { ReleaseType, VersionPatterns, WorkTypeConfig } from './types.ts';

/** The part of a changelog item or parsed commit that decides its bump: its resolved work type and breaking flag. */
export interface BumpSignal {
  type: string;
  breaking: boolean;
}

/** Priority of release types, from highest to lowest. */
const RELEASE_PRIORITY: Record<ReleaseType, number> = {
  major: 3,
  minor: 2,
  patch: 1,
};

/**
 * Determines the overall bump type from a set of changes, returning undefined when none triggers a bump.
 *
 * Uses `versionPatterns` to decide which types trigger major/minor bumps.
 * The `'!'` sentinel in `versionPatterns.major` means "any breaking change triggers major".
 * A recognized type listed in `versionPatterns.none` (the default list when omitted) triggers no bump; any other
 * recognized type not listed in major or minor patterns defaults to patch.
 */
export function determineBumpType(
  changes: readonly BumpSignal[],
  workTypes: Record<string, WorkTypeConfig>,
  versionPatterns: VersionPatterns,
): ReleaseType | undefined {
  const knownTypes = new Set(Object.keys(workTypes));
  const nonBumpingTypes = new Set(versionPatterns.none ?? DEFAULT_VERSION_PATTERNS.none);

  let highestPriority = 0;
  let result: ReleaseType | undefined;

  for (const change of changes) {
    if (change.breaking && versionPatterns.major.includes('!')) {
      return 'major';
    }

    if (!knownTypes.has(change.type)) {
      continue;
    }

    let bump: ReleaseType;
    if (versionPatterns.major.includes(change.type)) {
      bump = 'major';
    } else if (versionPatterns.minor.includes(change.type)) {
      bump = 'minor';
    } else if (nonBumpingTypes.has(change.type)) {
      continue;
    } else {
      bump = 'patch';
    }

    const priority = RELEASE_PRIORITY[bump];

    if (priority <= highestPriority) {
      continue;
    }

    highestPriority = priority;
    result = bump;
  }

  return result;
}
