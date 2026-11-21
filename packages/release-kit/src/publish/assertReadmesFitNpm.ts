import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isRecord, UserError } from '@williamthorsen/nmr-core';

import { readChangelogEntries } from '../changelog/changelog-entries.ts';
import { readJsonFile } from '../portable/readJsonFile.ts';
import { resolveNpmReadme, resolveReadmePath } from '../release-notes/injectReleaseNotesIntoReadme.ts';
import { isPublishableManifest } from '../targets/isPublishableManifest.ts';
import type { ChangelogEntry } from '../types.ts';

/** The length, in code points, beyond which the npm registry truncates a package's `readme` field. */
export const NPM_README_MAX_CODE_POINTS = 65_536;

/** A workspace's README as npm will receive it. */
export interface NpmReadme {
  workspacePath: string;
  readmePath: string;
  content: string;
}

/**
 * Throws when the README of a publishable package among the given ones exceeds the length at which npm truncates it.
 *
 * Each workspace path is repo-relative and is read from the current directory. A private package is not checked.
 */
export function assertReadmesFitNpm(readmes: readonly NpmReadme[]): void {
  const oversizedReadmes = readmes
    .map((readme) => ({ ...readme, manifest: readManifest(readme.workspacePath) }))
    .filter(({ manifest }) => isPublishableManifest(manifest))
    .map((readme) => ({ ...readme, codePointCount: countCodePoints(readme.content) }))
    .filter(({ codePointCount }) => codePointCount > NPM_README_MAX_CODE_POINTS);
  if (oversizedReadmes.length === 0) {
    return;
  }

  throw new UserError(describeRefusal(oversizedReadmes));
}

/**
 * Reads a workspace's README and returns it as npm will receive it, with the tag's release notes injected from
 * `entries` when they are defined; returns `undefined` when the workspace doesn't have a README.
 */
export function buildNpmReadme(
  workspacePath: string,
  entries: readonly ChangelogEntry[] | undefined,
  tag: string,
  sectionOrder?: string[],
): NpmReadme | undefined {
  const readmePath = resolveReadmePath(workspacePath);
  if (readmePath === undefined) {
    return undefined;
  }
  const readme = readFileSync(readmePath, 'utf8');
  return { workspacePath, readmePath, content: resolveNpmReadme(readme, entries, tag, sectionOrder) };
}

/**
 * Builds the npm-bound README of each tagged workspace, injecting the tag's release notes from the `changelog.json`
 * at `changelogJsonOutputPath` under the workspace, or none when the path is `undefined`. A workspace without a README
 * is left out.
 */
export function buildTaggedNpmReadmes(
  tags: ReadonlyArray<{ tag: string; workspacePath: string }>,
  changelogJsonOutputPath: string | undefined,
  sectionOrder?: string[],
): NpmReadme[] {
  return tags.flatMap(({ tag, workspacePath }) => {
    const entries =
      changelogJsonOutputPath === undefined
        ? undefined
        : readChangelogEntries(join(workspacePath, changelogJsonOutputPath));
    return buildNpmReadme(workspacePath, entries, tag, sectionOrder) ?? [];
  });
}

/** Counts the code points of a string, which npm measures, rather than the UTF-16 units that `length` counts. */
export function countCodePoints(text: string): number {
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- npm counts code points, which the spread yields.
  return [...text].length;
}

// region | Helpers

/** Composes the refusal message, listing each package with its README's length. */
function describeRefusal(
  oversizedReadmes: ReadonlyArray<{
    workspacePath: string;
    readmePath: string;
    manifest: Record<string, unknown>;
    codePointCount: number;
  }>,
): string {
  const cap = formatCount(NPM_README_MAX_CODE_POINTS);
  const lines = [`Cannot release: npm truncates a README longer than ${cap} code points.`];

  for (const { workspacePath, readmePath, manifest, codePointCount } of oversizedReadmes) {
    const name = typeof manifest['name'] === 'string' ? manifest['name'] : workspacePath;
    const excess = formatCount(codePointCount - NPM_README_MAX_CODE_POINTS);
    lines.push(`  - ${name} (${readmePath}): ${formatCount(codePointCount)} code points, ${excess} over the cap`);
  }

  return [
    lines.join('\n'),
    'Shorten the README, or the all-audience release notes that release-kit injects into it, until it fits.',
  ].join('\n\n');
}

/** Formats a count with thousands separators. */
function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}

/** Reads a workspace's `package.json`, returning an empty record when it is not an object. */
function readManifest(workspacePath: string): Record<string, unknown> {
  const manifest = readJsonFile(join(workspacePath, 'package.json'));
  return isRecord(manifest) ? manifest : {};
}

// endregion | Helpers
