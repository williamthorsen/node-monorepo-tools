import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isPublishableManifest } from './isPublishableManifest.ts';
import { lookUpNpmPackage } from './npmRegistry.ts';
import { isRecord } from './typeGuards.ts';

/**
 * Throws when npm doesn't list, or can't confirm, a publishable package among the given workspaces.
 *
 * Each workspace path is repo-relative and is read from the current directory. A private package is not looked up,
 * and an empty list doesn't call the registry at all.
 */
export function assertReleasesOnNpm(workspacePaths: readonly string[]): void {
  const unpublished: NpmCandidate[] = [];
  const unverifiable: Array<{ candidate: NpmCandidate; detail: string }> = [];

  for (const workspacePath of workspacePaths) {
    const candidate = buildNpmCandidate(workspacePath);
    if (candidate === undefined) {
      continue;
    }

    const lookup = lookUpNpmPackage(candidate.name, candidate.registry);
    if (lookup.status === 'unpublished') {
      unpublished.push(candidate);
    } else if (lookup.status === 'unverifiable') {
      unverifiable.push({ candidate, detail: lookup.detail });
    }
  }

  if (unpublished.length === 0 && unverifiable.length === 0) {
    return;
  }

  throw new Error(describeRefusal(unpublished, unverifiable));
}

// region | Helpers
interface NpmCandidate {
  name: string;
  workspacePath: string;
  registry?: string;
}

/** Reads a workspace's `package.json` into a candidate for the npm lookup, or returns undefined when it is private. */
function buildNpmCandidate(workspacePath: string): NpmCandidate | undefined {
  const manifest: unknown = JSON.parse(readFileSync(join(workspacePath, 'package.json'), 'utf8'));
  if (!isRecord(manifest) || !isPublishableManifest(manifest) || typeof manifest['name'] !== 'string') {
    return undefined;
  }

  const publishConfig = manifest['publishConfig'];
  const registry = isRecord(publishConfig) ? publishConfig['registry'] : undefined;
  return {
    name: manifest['name'],
    workspacePath,
    ...(typeof registry === 'string' && { registry }),
  };
}

/** Composes the refusal message, listing each package that npm doesn't list and each that it couldn't confirm. */
function describeRefusal(
  unpublished: readonly NpmCandidate[],
  unverifiable: ReadonlyArray<{ candidate: NpmCandidate; detail: string }>,
): string {
  const sections = ['Cannot prepare the release: npm must already have every package that the release publishes.'];

  if (unpublished.length > 0) {
    sections.push(
      [
        'Not on npm yet:',
        ...unpublished.map(
          ({ name, workspacePath }) => `  - ${name}: run "npm publish --access public" from ${workspacePath}`,
        ),
        'Then register each one as a trusted publisher; "rdy run --from npm:@williamthorsen/release-kit npm-auto-publish" prints the command.',
      ].join('\n'),
    );
  }

  if (unverifiable.length > 0) {
    sections.push(
      [
        'Could not confirm on npm:',
        ...unverifiable.map(({ candidate, detail }) => `  - ${candidate.name}: ${detail}`),
      ].join('\n'),
    );
  }

  return sections.join('\n\n');
}
// endregion | Helpers
