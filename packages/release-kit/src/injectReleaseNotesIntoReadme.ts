import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { extractVersion, readChangelogEntries } from './changelogJsonUtils.ts';
import { injectSection } from './injectSection.ts';
import { matchesAudience, renderReleaseNotesSingle } from './renderReleaseNotes.ts';

/** Rendered artifacts produced by `renderInjectedReadme`. */
export interface RenderedInjectedReadme {
  /** The README with the release-notes section injected at the marker position. */
  injectedReadme: string;
  /** The standalone release-notes markdown for the target version (trimmed). */
  releaseNotesMarkdown: string;
}

/**
 * Render a README with release notes injected at the marker position, and the standalone
 * release-notes markdown, from an already-loaded README string and a changelog JSON path.
 *
 * This is the pure rendering core shared by both the publish-time injection flow and the
 * `--with-release-notes` preview flow. It performs no file writes; callers decide whether to
 * persist the artifacts.
 *
 * Returns `undefined` when any skip condition applies (missing or unparseable changelog, no
 * entry for the version, or no public-audience sections).
 */
export function renderInjectedReadme(
  readme: string,
  changelogJsonPath: string,
  tag: string,
  sectionOrder?: string[],
): RenderedInjectedReadme | undefined {
  if (!existsSync(changelogJsonPath)) {
    console.warn(`Warning: ${changelogJsonPath} not found; skipping README injection`);
    return undefined;
  }

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
    ...(sectionOrder === undefined ? {} : { sectionOrder }),
  });

  if (releaseNotesMarkdown.trimEnd().length === 0) {
    console.warn(`Warning: no user-facing release notes for version ${version}; skipping README injection`);
    return undefined;
  }

  const trimmedReleaseNotes = releaseNotesMarkdown.trimEnd();
  const injectedReadme = injectSection(readme, 'release-notes', trimmedReleaseNotes);

  return { injectedReadme, releaseNotesMarkdown: trimmedReleaseNotes };
}

/**
 * Inject release notes into a README and return the original content for restoration.
 *
 * Returns the original README content, or `undefined` if injection was skipped.
 */
export function injectReleaseNotesIntoReadme(
  readmePath: string,
  changelogJsonPath: string,
  tag: string,
  sectionOrder?: string[],
): string | undefined {
  // Short-circuit when the changelog JSON is missing so the README file isn't read needlessly.
  if (!existsSync(changelogJsonPath)) {
    console.warn(`Warning: ${changelogJsonPath} not found; skipping README injection`);
    return undefined;
  }

  const originalReadme = readFileSync(readmePath, 'utf8');

  const rendered = renderInjectedReadme(originalReadme, changelogJsonPath, tag, sectionOrder);
  if (rendered === undefined) {
    return undefined;
  }

  writeFileSync(readmePath, rendered.injectedReadme, 'utf8');
  return originalReadme;
}

/** Find the README file in a workspace directory. */
export function resolveReadmePath(workspacePath: string): string | undefined {
  const readmePath = join(workspacePath, 'README.md');
  return existsSync(readmePath) ? readmePath : undefined;
}
