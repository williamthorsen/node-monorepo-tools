import type { ChangelogAudience, ChangelogEntry, ChangelogSection } from './types.ts';

/** Options for rendering a single changelog entry to markdown. */
export interface RenderOptions {
  /** Predicate to filter sections. When absent, all sections are included. */
  filter?: (section: ChangelogSection) => boolean;
  /** Whether to include the version/date heading. Defaults to `true`. */
  includeHeading?: boolean;
}

/**
 * Create a predicate that matches sections visible to the given audience.
 *
 * `"all"` matches only sections with `audience: "all"` (public-facing).
 * `"dev"` matches all sections (developers see everything).
 */
export function matchesAudience(audience: ChangelogAudience): (section: ChangelogSection) => boolean {
  if (audience === 'dev') {
    return () => true;
  }
  return (section) => section.audience === 'all';
}

/**
 * Render a single `ChangelogEntry` to markdown.
 *
 * Output format mirrors the existing CHANGELOG.md style: an H2 version heading followed by
 * H3 section headings with bulleted items.
 */
export function renderReleaseNotesSingle(entry: ChangelogEntry, options?: RenderOptions): string {
  const filter = options?.filter;
  const includeHeading = options?.includeHeading ?? true;

  const sections = filter !== undefined ? entry.sections.filter(filter) : entry.sections;

  if (sections.length === 0) {
    return '';
  }

  const lines: string[] = [];

  if (includeHeading) {
    lines.push(`## ${entry.version} — ${entry.date}`);
  }

  for (const section of sections) {
    lines.push('', `### ${section.title}`, '');
    for (const item of section.items) {
      lines.push(`- ${item.description}`);
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Render multiple `ChangelogEntry` values to a single markdown document.
 *
 * Entries are rendered in the order provided; the caller is responsible for sorting.
 */
export function renderReleaseNotesMulti(entries: ChangelogEntry[], options?: RenderOptions): string {
  const parts = entries.map((entry) => renderReleaseNotesSingle(entry, options)).filter((part) => part.length > 0);
  return parts.join('\n');
}
