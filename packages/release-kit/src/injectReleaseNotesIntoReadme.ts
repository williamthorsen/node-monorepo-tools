import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { extractVersion, loadChangelogEntries } from './changelogJsonUtils.ts';
import { injectSection } from './injectSection.ts';
import { matchesAudience, renderReleaseNotesSingle } from './renderReleaseNotes.ts';
import type { ChangelogEntry } from './types.ts';

/** Rendered artifacts produced by `renderInjectedReadme`. */
export interface RenderedInjectedReadme {
  /** The README with the release-notes section injected at the marker position. */
  injectedReadme: string;
  /** The standalone release-notes markdown for the target version, trimmed and led by a `## Release notes` heading. */
  releaseNotesMarkdown: string;
}

/**
 * Discriminated reason why release notes were not rendered for a tag.
 *
 * Shares the vocabulary of `CreateReleaseSkipReason` in `createGithubRelease.ts`, which classifies
 * the same two conditions on the GitHub-release path.
 */
export type RenderInjectedReadmeSkipReason = 'no-entry' | 'empty-body';

/** Discriminated outcome of rendering release notes for a tag. */
export type RenderInjectedReadmeResult =
  | { status: 'rendered'; renderedReadme: RenderedInjectedReadme }
  | { status: 'skipped'; reason: RenderInjectedReadmeSkipReason; version: string };

/**
 * Renders a README with release notes injected at the marker position, and the standalone
 * release-notes markdown, from an already-loaded README string and an in-memory entry set.
 *
 * This is the pure rendering core: It reads nothing, writes nothing, and reports nothing, so a
 * caller that has entries that a release has computed but not yet written gets the same result as
 * one rendering from a saved file, and each caller words a skip for its own output.
 *
 * Returns the version on a skip because both callers name it in their message and only this
 * function has derived it from the tag.
 */
export function renderInjectedReadmeFromEntries(
  readme: string,
  entries: readonly ChangelogEntry[],
  tag: string,
  sectionOrder?: string[],
): RenderInjectedReadmeResult {
  const version = extractVersion(tag);

  const entry = entries.find((e) => e.version === version);
  if (entry === undefined) {
    return { status: 'skipped', reason: 'no-entry', version };
  }

  const renderedSections = renderReleaseNotesSingle(entry, {
    filter: matchesAudience('all'),
    shouldIncludeHeading: false,
    ...(sectionOrder !== undefined && { sectionOrder }),
  });

  if (renderedSections.trimEnd().length === 0) {
    return { status: 'skipped', reason: 'empty-body', version };
  }

  // Prepend a labeled heading so that readers can see both that the content is release notes
  // and which version they describe. The README-injected form and the standalone preview
  // share this heading; the GitHub-release body (rendered elsewhere) omits it because the
  // release page already shows the tag and date.
  const labeledHeading = `## Release notes — v${version} (${entry.date})`;
  const releaseNotesMarkdown = `${labeledHeading}\n\n${renderedSections.trimEnd()}`;
  const injectedReadme = injectSection(readme, 'release-notes', releaseNotesMarkdown);

  return { status: 'rendered', renderedReadme: { injectedReadme, releaseNotesMarkdown } };
}

/** Why `renderInjectedReadme` did not render a README, with the version when the reason concerns one. */
export type ReadmeInjectionSkip =
  { reason: 'missing-file' | 'unreadable-file' } | { reason: RenderInjectedReadmeSkipReason; version: string };

/** Discriminated outcome of rendering release notes from a saved `changelog.json`. */
export type RenderInjectedReadmeFromFileResult =
  { status: 'rendered'; renderedReadme: RenderedInjectedReadme } | { status: 'skipped'; skip: ReadmeInjectionSkip };

/** Discriminated outcome of injecting release notes into a README file. */
export type InjectReleaseNotesResult =
  { status: 'injected'; originalReadme: string } | { status: 'skipped'; skip: ReadmeInjectionSkip };

/**
 * Path-taking wrapper over {@link renderInjectedReadmeFromEntries} for callers rendering from a
 * saved `changelog.json`, such as the publish-time injection flow.
 *
 * Adds the two skip conditions that only a file can present: The changelog is missing, or it cannot
 * be read as entries.
 */
export function renderInjectedReadme(
  readme: string,
  changelogJsonPath: string,
  tag: string,
  sectionOrder?: string[],
): RenderInjectedReadmeFromFileResult {
  const loaded = loadChangelogEntries(changelogJsonPath);
  if (loaded.status === 'missing') {
    return { status: 'skipped', skip: { reason: 'missing-file' } };
  }
  if (loaded.status === 'unreadable') {
    return { status: 'skipped', skip: { reason: 'unreadable-file' } };
  }

  const result = renderInjectedReadmeFromEntries(readme, loaded.entries, tag, sectionOrder);
  if (result.status === 'skipped') {
    return { status: 'skipped', skip: { reason: result.reason, version: result.version } };
  }

  return result;
}

/**
 * Injects release notes into a README file, returning the original content for restoration, or the skip when
 * injection did not happen.
 */
export function injectReleaseNotesIntoReadme(
  readmePath: string,
  changelogJsonPath: string,
  tag: string,
  sectionOrder?: string[],
): InjectReleaseNotesResult {
  const originalReadme = readFileSync(readmePath, 'utf8');

  const renderResult = renderInjectedReadme(originalReadme, changelogJsonPath, tag, sectionOrder);
  if (renderResult.status === 'skipped') {
    return renderResult;
  }

  writeFileSync(readmePath, renderResult.renderedReadme.injectedReadme, 'utf8');
  return { status: 'injected', originalReadme };
}

/** Returns the path of a workspace's `README.md`, or `undefined` when it has none. */
export function resolveReadmePath(workspacePath: string): string | undefined {
  const readmePath = join(workspacePath, 'README.md');
  return existsSync(readmePath) ? readmePath : undefined;
}
