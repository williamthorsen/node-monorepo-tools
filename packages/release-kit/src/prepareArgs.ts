/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { parseArgsOrExit, reportError } from '@williamthorsen/nmr-core';

import { configFlagSchema } from './configFlagSchema.ts';
import type { ReleaseType } from './types.ts';

const VALID_BUMP_TYPES: readonly string[] = ['major', 'minor', 'patch'];

/** Canonical `N.N.N` semver pattern for validating `--set-version` input. */
export const CANONICAL_SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

export const prepareFlagSchema = {
  ...configFlagSchema,
  isDryRun: { long: '--dry-run', type: 'boolean' as const },
  shouldForce: { long: '--force', type: 'boolean' as const },
  shouldSkipGitChecks: {
    long: '--no-git-checks',
    type: 'boolean' as const,
    short: '-n',
  },
  bump: { long: '--bump', type: 'string' as const },
  setVersion: { long: '--set-version', type: 'string' as const },
  only: { long: '--only', type: 'string' as const },
  shouldIncludeReleaseNotes: { long: '--with-release-notes', type: 'boolean' as const },
};

/** Parses CLI arguments into structured options. Prints a usage error and exits on invalid input. */
export function parseArgs(argv: string[]): {
  configPath: string | undefined;
  isDryRun: boolean;
  shouldForce: boolean;
  shouldSkipGitChecks: boolean;
  bumpOverride: ReleaseType | undefined;
  onlyNames: string[] | undefined;
  /** The raw `--set-version` value, whose accepted form depends on the mode. */
  setVersion: string | undefined;
  shouldIncludeReleaseNotes: boolean;
} {
  const { flags } = parseArgsOrExit(argv, prepareFlagSchema);

  let bumpOverride: ReleaseType | undefined;
  if (flags.bump !== undefined) {
    if (!isReleaseType(flags.bump)) {
      reportError(`Invalid bump type "${flags.bump}". Must be one of: ${VALID_BUMP_TYPES.join(', ')}`);
      process.exit(1);
    }
    bumpOverride = flags.bump;
  }

  let onlyNames: string[] | undefined;
  if (flags.only !== undefined) {
    onlyNames = flags.only.split(',');
  }

  return {
    configPath: flags.config,
    isDryRun: flags.isDryRun,
    shouldForce: flags.shouldForce,
    shouldSkipGitChecks: flags.shouldSkipGitChecks,
    bumpOverride,
    onlyNames,
    setVersion: flags.setVersion,
    shouldIncludeReleaseNotes: flags.shouldIncludeReleaseNotes,
  };
}

/**
 * Parses a monorepo `--set-version` value, a comma-separated list of `<target>@N.N.N` entries, into versions keyed by
 * target name. Prints a usage error and exits on a malformed entry, an unknown target, or a repeated one.
 */
export function parseSetVersions(value: string, knownNames: readonly string[]): Map<string, string> {
  const setVersions = new Map<string, string>();
  for (const entry of value.split(',')) {
    const separatorIndex = entry.lastIndexOf('@');
    const name = entry.slice(0, Math.max(0, separatorIndex));
    const version = entry.slice(separatorIndex + 1);
    if (separatorIndex <= 0 || !CANONICAL_SEMVER_PATTERN.test(version)) {
      reportError(
        `Invalid --set-version entry "${entry}". In monorepo mode, each entry must be <target>@N.N.N ` +
          '(canonical semver, no pre-release suffix), e.g. --set-version=arrays@1.0.0.',
      );
      process.exit(1);
    }
    if (!knownNames.includes(name)) {
      reportError(`Unknown release target "${name}" in --set-version. Known targets: ${knownNames.join(', ')}`);
      process.exit(1);
    }
    if (setVersions.has(name)) {
      reportError(`--set-version names target "${name}" more than once`);
      process.exit(1);
    }
    setVersions.set(name, version);
  }
  return setVersions;
}

// region | Helpers

/** Narrows a `--bump` value to a `ReleaseType`. */
function isReleaseType(value: string): value is ReleaseType {
  return VALID_BUMP_TYPES.includes(value);
}

// endregion | Helpers
