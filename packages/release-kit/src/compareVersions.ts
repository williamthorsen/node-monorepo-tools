import semver from 'semver';

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

  // The pattern has exactly three capture groups, so a successful match always yields
  // defined strings in positions 1..3. Fallback empty strings make the destructuring
  // type-safe without adding a redundant runtime guard; `Number.parseInt('', 10)` is `NaN`,
  // which is unreachable given the `!match` early exit above.
  const [, major = '', minor = '', patch = ''] = match;

  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
  };
}

/**
 * Compare two version strings in descending order (newest first).
 *
 * Valid SemVer inputs are ordered per SemVer §11 (delegated to `semver.rcompare`): prerelease
 * versions precede the corresponding release (`1.2.3-alpha < 1.2.3`), and build metadata is
 * ignored for ordering. Inputs that fail `semver.valid` sort to the bottom of the descending
 * list, ordered lexically among themselves. The comparator never throws.
 */
export function compareVersionsDescending(a: string, b: string): number {
  const aValid = semver.valid(a);
  const bValid = semver.valid(b);
  if (aValid && bValid) return semver.rcompare(aValid, bValid);
  if (aValid) return -1;
  if (bValid) return 1;
  if (a > b) return -1;
  if (a < b) return 1;
  return 0;
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
