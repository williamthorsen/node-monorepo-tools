/** Canonical semver regex used to validate `N.N.N` strings (no pre-release or build metadata). */
const CANONICAL_SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/** Parsed canonical semver components. */
interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parse a canonical semver version string into its numeric components.
 *
 * @throws If the version string is not canonical `N.N.N` semver (pre-release or build metadata is rejected).
 */
function parseCanonicalSemver(version: string): ParsedVersion {
  const match = version.match(CANONICAL_SEMVER_PATTERN);
  if (!match) {
    throw new Error(`Invalid semver version: '${version}'`);
  }

  const major = match[1];
  const minor = match[2];
  const patch = match[3];

  if (major === undefined || minor === undefined || patch === undefined) {
    throw new Error(`Invalid semver version: '${version}'`);
  }

  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
  };
}

/**
 * Return true when `target` is strictly greater than `current`, comparing major, minor, then patch.
 *
 * Equal versions return false. Comparison is numeric (not lexical), so `0.10.0` is greater than `0.9.0`.
 *
 * @throws If either version is not canonical `N.N.N` semver.
 */
export function isForwardVersion(current: string, target: string): boolean {
  const currentParsed = parseCanonicalSemver(current);
  const targetParsed = parseCanonicalSemver(target);

  if (targetParsed.major !== currentParsed.major) {
    return targetParsed.major > currentParsed.major;
  }
  if (targetParsed.minor !== currentParsed.minor) {
    return targetParsed.minor > currentParsed.minor;
  }
  return targetParsed.patch > currentParsed.patch;
}
