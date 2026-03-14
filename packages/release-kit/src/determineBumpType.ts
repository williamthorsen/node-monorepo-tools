import type { ParsedCommit, ReleaseType, VersionPatterns, WorkTypeConfig } from './types.ts';

/** Priority of release types, from highest to lowest. */
const RELEASE_PRIORITY: Record<ReleaseType, number> = {
  major: 3,
  minor: 2,
  patch: 1,
};

/**
 * Determines the overall bump type from a set of parsed commits.
 *
 * Uses `versionPatterns` to decide which commit types trigger major/minor bumps.
 * The `'!'` sentinel in `versionPatterns.major` means "any breaking commit triggers major".
 * Any recognized commit type not listed in major or minor patterns defaults to patch.
 *
 * @param commits - The parsed commits to analyze.
 * @param workTypes - The work type configurations to verify recognized types.
 * @param versionPatterns - Rules for determining major and minor bumps.
 * @returns The determined release type, or undefined if no commits match a known work type.
 */
export function determineBumpType(
  commits: readonly ParsedCommit[],
  workTypes: Record<string, WorkTypeConfig>,
  versionPatterns: VersionPatterns,
): ReleaseType | undefined {
  const knownTypes = new Set(Object.keys(workTypes));

  let highestPriority = 0;
  let result: ReleaseType | undefined;

  for (const commit of commits) {
    // Breaking changes: check if '!' sentinel is in versionPatterns.major
    if (commit.breaking && versionPatterns.major.includes('!')) {
      return 'major';
    }

    const commitType = commit.type;

    // Skip unrecognized types
    if (!knownTypes.has(commitType)) {
      continue;
    }

    // Check if the type itself is listed in major patterns (non-sentinel)
    let bump: ReleaseType;
    if (versionPatterns.major.includes(commitType)) {
      bump = 'major';
    } else if (versionPatterns.minor.includes(commitType)) {
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
