import { UserError } from '@williamthorsen/nmr-core';

import { lookUpNpmPackage, type Npm, realNpm } from '../clients/npm/npm-registry.ts';
import { type NpmCandidate, readNpmCandidate } from './readNpmCandidate.ts';

/**
 * Throws when npm doesn't list, or can't confirm, a publishable package among the given workspaces.
 *
 * Each workspace path is repo-relative and is read from the current directory. A private package is not looked up,
 * and an empty list doesn't call the registry at all.
 */
export function assertReleasesOnNpm(workspacePaths: readonly string[], npm: Npm = realNpm): void {
  const unpublishedCandidates: NpmCandidate[] = [];
  const unverifiableCandidates: Array<{ candidate: NpmCandidate; detail: string }> = [];

  for (const workspacePath of workspacePaths) {
    const candidate = readNpmCandidate(workspacePath);
    if (candidate === undefined) {
      continue;
    }

    const lookup = lookUpNpmPackage(candidate.name, candidate.registry, npm);
    if (lookup.status === 'unpublished') {
      unpublishedCandidates.push(candidate);
    } else if (lookup.status === 'unverifiable') {
      unverifiableCandidates.push({ candidate, detail: lookup.detail });
    }
  }

  if (unpublishedCandidates.length === 0 && unverifiableCandidates.length === 0) {
    return;
  }

  throw new UserError(describeRefusal(unpublishedCandidates, unverifiableCandidates));
}

// region | Helpers
/** Composes the refusal message, listing each package that npm doesn't list and each that it couldn't confirm. */
function describeRefusal(
  unpublishedCandidates: readonly NpmCandidate[],
  unverifiableCandidates: ReadonlyArray<{ candidate: NpmCandidate; detail: string }>,
): string {
  const sections = ['Cannot prepare the release: npm must already have every package that the release publishes.'];

  if (unpublishedCandidates.length > 0) {
    sections.push(
      [
        'Not on npm yet:',
        ...unpublishedCandidates.map(
          ({ name, workspacePath }) => `  - ${name}: run "npm publish --access public" from ${workspacePath}`,
        ),
        'Then register each one as a trusted publisher; "rdy run --from npm:@williamthorsen/release-kit npm-auto-publish" prints the command.',
      ].join('\n'),
    );
  }

  if (unverifiableCandidates.length > 0) {
    sections.push(
      [
        'Could not confirm on npm:',
        ...unverifiableCandidates.map(({ candidate, detail }) => `  - ${candidate.name}: ${detail}`),
      ].join('\n'),
    );
  }

  return sections.join('\n\n');
}
// endregion | Helpers
