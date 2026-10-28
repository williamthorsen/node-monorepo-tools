import type { ReleaseType } from './types.ts';

/** Bumps a `major.minor.patch` version by the release type; throws on a version of any other form. */
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

  const majorNumber = Number.parseInt(major, 10);
  const minorNumber = Number.parseInt(minor, 10);
  const patchNumber = Number.parseInt(patch, 10);

  switch (releaseType) {
    case 'major':
      // Pre-1.0 packages are in "initial development" per semver; a breaking change
      // should not implicitly promote to 1.0.0. Collapse to a minor bump instead.
      if (majorNumber === 0) {
        return `0.${minorNumber + 1}.0`;
      }
      return `${majorNumber + 1}.0.0`;
    case 'minor':
      return `${majorNumber}.${minorNumber + 1}.0`;
    case 'patch':
      return `${majorNumber}.${minorNumber}.${patchNumber + 1}`;
  }
}
