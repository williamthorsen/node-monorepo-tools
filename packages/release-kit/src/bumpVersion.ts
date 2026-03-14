import type { ReleaseType } from './types.ts';

/**
 * Bumps a semver version string by the given release type.
 *
 * @param version - A semver version string (e.g., '1.2.3').
 * @param releaseType - The type of release bump to apply.
 * @returns The bumped version string.
 * @throws If the version string is not a valid semver format.
 */
export function bumpVersion(version: string, releaseType: ReleaseType): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid semver version: '${version}'`);
  }

  const major = match[1];
  const minor = match[2];
  const patch = match[3];

  if (major === undefined || minor === undefined || patch === undefined) {
    throw new Error(`Invalid semver version: '${version}'`);
  }

  const majorNum = Number.parseInt(major, 10);
  const minorNum = Number.parseInt(minor, 10);
  const patchNum = Number.parseInt(patch, 10);

  switch (releaseType) {
    case 'major':
      return `${majorNum + 1}.0.0`;
    case 'minor':
      return `${majorNum}.${minorNum + 1}.0`;
    case 'patch':
      return `${majorNum}.${minorNum}.${patchNum + 1}`;
  }
}
