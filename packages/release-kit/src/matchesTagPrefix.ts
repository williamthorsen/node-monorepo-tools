/**
 * A complete SemVer version with optional pre-release and build metadata, which excludes floating
 * pointers such as `v1` or `v1.2` that share a release prefix.
 */
const SEMVER_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Checks whether a tag name is one of the prefixes followed by a complete SemVer version. */
export function matchesTagPrefix(tagName: string, tagPrefixes: readonly string[]): boolean {
  return tagPrefixes.some(
    (prefix) => tagName.startsWith(prefix) && SEMVER_VERSION_PATTERN.test(tagName.slice(prefix.length)),
  );
}
