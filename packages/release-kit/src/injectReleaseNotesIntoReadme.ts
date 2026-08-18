import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { extractVersion, readChangelogEntries } from './changelogJsonUtils.ts';
import { injectSection } from './injectSection.ts';
import { matchesAudience, renderReleaseNotesSingle } from './renderReleaseNotes.ts';
import type { ChangelogEntry } from './types.ts';

/** Rendered artifacts produced by `renderInjectedReadme`. */
export interface RenderedInjectedReadme {
  /** The README with the release-notes section injected at the marker position. */
  injectedReadme: string;
  /**
   * The standalone release-notes markdown for the target version (trimmed), prefixed with a
   * labeled `## Release notes — v{version} ({date})` heading so the file is self-identifying.
   * The GitHub-release body is rendered separately (without this heading) by `createGithubRelease`.
   */
  releaseNotesMarkdown: string;
}

/**
 * Discriminated reason no release notes were rendered for a tag.
 *
 * Shares the vocabulary of `CreateReleaseSkipReason` in `createGithubRelease.ts`, which classifies
 * the same two conditions on the GitHub-release path.
 */
export type RenderInjectedReadmeSkipReason = 'no-entry' | 'empty-body';

/** Discriminated outcome of rendering release notes for a tag. */
export type RenderInjectedReadmeResult =
  | { status: 'rendered'; rendered: RenderedInjectedReadme }
  | { status: 'skipped'; reason: RenderInjectedReadmeSkipReason; version: string };

/**
 * Renders a README with release notes injected at the marker position, and the standalone
 * release-notes markdown, from an already-loaded README string and an in-memory entry set.
 *
 * This is the pure rendering core: it reads nothing, writes nothing, and reports nothing, so a
 * caller holding entries a release has computed but not yet written gets the same result as one
 * rendering from a saved file, and each caller words a skip for its own output.
 *
 * Carries the version on a skip because both callers name it in their message and only this
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
    includeHeading: false,
    ...(sectionOrder !== undefined && { sectionOrder }),
  });

  if (renderedSections.trimEnd().length === 0) {
    return { status: 'skipped', reason: 'empty-body', version };
  }

  // Prepend a labeled heading so readers can see both that the content is release notes
  // and which version they describe. The README-injected form and the standalone preview
  // share this heading; the GitHub-release body (rendered elsewhere) omits it because the
  // release page already shows the tag and date.
  const labeledHeading = `## Release notes — v${version} (${entry.date})`;
  const releaseNotesMarkdown = `${labeledHeading}\n\n${renderedSections.trimEnd()}`;
  const injectedReadme = injectSection(readme, 'release-notes', releaseNotesMarkdown);

  return { status: 'rendered', rendered: { injectedReadme, releaseNotesMarkdown } };
}

/**
 * Path-taking wrapper over {@link renderInjectedReadmeFromEntries} for callers rendering from a
 * saved `changelog.json`, such as the publish-time injection flow.
 *
 * Adds the two skip conditions that only a file can present: the changelog is missing, or it does
 * not parse. Warns on every skip, its own and the renderer's alike, because the publish path has
 * no other channel for the message.
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

  const entries = readChangelogEntries(changelogJsonPath);
  if (entries === undefined) {
    console.warn(`Warning: could not parse ${changelogJsonPath}; skipping README injection`);
    return undefined;
  }

  const result = renderInjectedReadmeFromEntries(readme, entries, tag, sectionOrder);
  if (result.status === 'skipped') {
    console.warn(`Warning: ${describeRenderSkip(result.reason, result.version)}; skipping README injection`);
    return undefined;
  }

  return result.rendered;
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

// region | Helpers

/** Describes a render skip as a phrase naming the reason and the version it applies to. */
function describeRenderSkip(reason: RenderInjectedReadmeSkipReason, version: string): string {
  return reason === 'no-entry'
    ? `no changelog entry for version ${version}`
    : `no user-facing release notes for version ${version}`;
}

// endregion | Helpers
