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
 * Parses a canonical `N.N.N` version into its numeric components; throws on a pre-release, build metadata, or any
 * other form.
 */
function parseCanonicalSemver(version: string): ParsedVersion {
  const match = version.match(CANONICAL_SEMVER_PATTERN);
  if (!match) {
    throw new Error(`Invalid semver version: '${version}'`);
  }

  // A match always fills all three groups; the defaults only satisfy the type checker.
  const [, major = '', minor = '', patch = ''] = match;

  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
  };
}

/**
 * Compares two version strings in descending order (newest first).
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
 * Reports whether `target` is strictly greater than `current`, comparing major, minor, then patch numerically; throws
 * unless both are canonical `N.N.N` semver.
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
