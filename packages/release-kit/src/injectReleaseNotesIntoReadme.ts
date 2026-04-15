import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { extractVersion, readChangelogEntries } from './changelogJsonUtils.ts';
import { injectSection } from './injectSection.ts';
import { matchesAudience, renderReleaseNotesSingle } from './renderReleaseNotes.ts';

/**
 * Inject release notes into a README and return the original content for restoration.
 *
 * Returns the original README content, or `undefined` if injection was skipped.
 */
export function injectReleaseNotesIntoReadme(
  readmePath: string,
  changelogJsonPath: string,
  tag: string,
): string | undefined {
  if (!existsSync(changelogJsonPath)) {
    console.warn(`Warning: ${changelogJsonPath} not found; skipping README injection`);
    return undefined;
  }

  const originalReadme = readFileSync(readmePath, 'utf8');

  const version = extractVersion(tag);
  const entries = readChangelogEntries(changelogJsonPath);
  if (entries === undefined) {
    console.warn(`Warning: could not parse ${changelogJsonPath}; skipping README injection`);
    return undefined;
  }

  const entry = entries.find((e) => e.version === version);
  if (entry === undefined) {
    console.warn(`Warning: no changelog entry for version ${version}; skipping README injection`);
    return undefined;
  }

  const releaseNotesMarkdown = renderReleaseNotesSingle(entry, {
    filter: matchesAudience('all'),
    includeHeading: false,
  });

  if (releaseNotesMarkdown.trimEnd().length === 0) {
    console.warn(`Warning: no user-facing release notes for version ${version}; skipping README injection`);
    return undefined;
  }

  const injected = injectSection(originalReadme, 'release-notes', releaseNotesMarkdown.trimEnd());
  writeFileSync(readmePath, injected, 'utf8');

  return originalReadme;
}

/** Find the README file in a workspace directory. */
export function resolveReadmePath(workspacePath: string): string | undefined {
  const readmePath = join(workspacePath, 'README.md');
  return existsSync(readmePath) ? readmePath : undefined;
}
