import type { ChangelogAudience, ChangelogEntry, ChangelogSection } from './types.ts';

/** Options for rendering a single changelog entry to markdown. */
export interface RenderOptions {
  /** Predicate to filter sections. When absent, all sections are included. */
  filter?: (section: ChangelogSection) => boolean;
  /** Whether to include the version/date heading. Defaults to `true`. */
  includeHeading?: boolean;
  /**
   * Section titles in desired priority order. Known titles are emitted first in this order;
   * titles not listed preserve their relative position after known ones. When absent, section
   * order is preserved from the entry.
   */
  sectionOrder?: string[];
}

function allSections() {
  return true;
}

function publicSections(section: ChangelogSection) {
  return section.audience === 'all';
}

/**
 * Create a predicate that matches sections visible to the given audience.
 *
 * `"all"` matches only sections with `audience: "all"` (public-facing).
 * `"dev"` matches all sections (developers see everything).
 */
export function matchesAudience(audience: ChangelogAudience): (section: ChangelogSection) => boolean {
  return audience === 'dev' ? allSections : publicSections;
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
  const sectionOrder = options?.sectionOrder;

  const filtered = filter !== undefined ? entry.sections.filter(filter) : entry.sections;
  const sections = sectionOrder !== undefined ? sortSectionsByOrder(filtered, sectionOrder) : filtered;

  if (sections.length === 0) {
    return '';
  }

  const lines: string[] = [];

  if (includeHeading) {
    lines.push(`## ${entry.version} — ${entry.date}`);
  }

  for (const section of sections) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(`### ${section.title}`, '');
    for (const [index, item] of section.items.entries()) {
      lines.push(`- ${item.description}`);
      if (item.body !== undefined && item.body.length > 0) {
        lines.push('', ...indentBodyLines(item.body));
        if (index < section.items.length - 1) {
          lines.push('');
        }
      }
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Stable-sort sections so that titles appearing in `order` come first in that order.
 * Unknown titles preserve their relative position after known ones.
 */
function sortSectionsByOrder(sections: ChangelogSection[], order: string[]): ChangelogSection[] {
  const priority = new Map<string, number>();
  for (const [index, title] of order.entries()) {
    priority.set(title, index);
  }
  const indexed = sections.map((section, index) => ({ section, index }));
  indexed.sort((a, b) => {
    const priorityA = priority.get(a.section.title) ?? Number.POSITIVE_INFINITY;
    const priorityB = priority.get(b.section.title) ?? Number.POSITIVE_INFINITY;
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    return a.index - b.index;
  });
  return indexed.map(({ section }) => section);
}

/** Indent each line of a body with two spaces so it renders as nested content under a bullet. */
function indentBodyLines(body: string): string[] {
  return body.split('\n').map((line) => (line.length === 0 ? '' : `  ${line}`));
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
