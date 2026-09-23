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
 * Determines the overall bump type from a set of changes, returning undefined when none has a known work type.
 *
 * Uses `versionPatterns` to decide which types trigger major/minor bumps.
 * The `'!'` sentinel in `versionPatterns.major` means "any breaking change triggers major".
 * Any recognized type not listed in major or minor patterns defaults to patch.
 */
export function determineBumpType(
  changes: readonly BumpSignal[],
  workTypes: Record<string, WorkTypeConfig>,
  versionPatterns: VersionPatterns,
): ReleaseType | undefined {
  const knownTypes = new Set(Object.keys(workTypes));

  let highestPriority = 0;
  let result: ReleaseType | undefined;

  for (const change of changes) {
    // Breaking changes: check if '!' sentinel is in versionPatterns.major
    if (change.breaking && versionPatterns.major.includes('!')) {
      return 'major';
    }

    // Skip unrecognized types
    if (!knownTypes.has(change.type)) {
      continue;
    }

    // Check if the type itself is listed in major patterns (non-sentinel)
    let bump: ReleaseType;
    if (versionPatterns.major.includes(change.type)) {
      bump = 'major';
    } else if (versionPatterns.minor.includes(change.type)) {
      bump = 'minor';
    } else {
      bump = 'patch';
    }

    const priority = RELEASE_PRIORITY[bump];

    if (priority > highestPriority) {
      highestPriority = priority;
      result = bump;
    }
  }

  return result;
}
