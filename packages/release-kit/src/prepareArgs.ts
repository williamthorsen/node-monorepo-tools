import { UsageError } from '@williamthorsen/nmr-core/cli';

/** Canonical `N.N.N` semver pattern for validating `--set-version` input. */
export const CANONICAL_SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * Parses a monorepo `--set-version` value, a comma-separated list of `<target>@N.N.N` entries, into versions keyed by
 * target name. Throws a `UsageError` for a malformed entry, an unknown target, or a repeated one.
 */
export function parseSetVersions(value: string, knownNames: readonly string[]): Map<string, string> {
  const setVersions = new Map<string, string>();
  for (const entry of value.split(',')) {
    const separatorIndex = entry.lastIndexOf('@');
    const name = entry.slice(0, Math.max(0, separatorIndex));
    const version = entry.slice(separatorIndex + 1);
    if (separatorIndex <= 0 || !CANONICAL_SEMVER_PATTERN.test(version)) {
      throw new UsageError(
        `Invalid --set-version entry "${entry}". In monorepo mode, each entry must be <target>@N.N.N ` +
          '(canonical semver, no pre-release suffix), e.g. --set-version=arrays@1.0.0.',
      );
    }
    if (!knownNames.includes(name)) {
      throw new UsageError(
        `Unknown release target "${name}" in --set-version. Known targets: ${knownNames.join(', ')}`,
      );
    }
    if (setVersions.has(name)) {
      throw new UsageError(`--set-version names target "${name}" more than once`);
    }
    setVersions.set(name, version);
  }
  return setVersions;
}
