import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { BuildInfo } from '../contract/types.ts';
import { isRecord } from './portable/isRecord.ts';

/** One version's release notes. */
export type ReleaseNotesEntry = NonNullable<BuildInfo['releaseNotes']> & { version: string };

/** Options of `readReleaseNotes`. */
export interface ReadReleaseNotesOptions {
  /** The directory whose changelog to read. Defaults to `process.cwd()`. */
  cwd?: string;
}

/** A `.meta/changelog.json` entry, holding only the fields that release notes read. */
interface ChangelogJsonEntry {
  version: string;
  date: string;
  sections: Array<{ title: string; audience: string; items: Array<{ description: string; body?: string }> }>;
}

/** Matches a `CHANGELOG.md` version heading, `## 0.7.0` or `## 0.7.0 — 2026-10-08`, but not `## [Unreleased]`. */
const VERSION_HEADING_PATTERN = /^## (\d\S*)(?: — (\S+))?\s*$/;

/**
 * Returns the release notes of one version. An entry for the version in `.meta/changelog.json` decides, even when it
 * has no public section; `CHANGELOG.md` is read only when the JSON is missing, malformed, or lacks the version.
 */
export function findReleaseNotes(cwd: string, version: string): BuildInfo['releaseNotes'] {
  const jsonEntry = readChangelogJson(cwd)?.find((entry) => entry.version === version);
  if (jsonEntry !== undefined) {
    return buildJsonReleaseNotes(jsonEntry);
  }
  const markdownEntry = readChangelogMarkdown(cwd).find((entry) => entry.version === version);
  if (markdownEntry === undefined) {
    return undefined;
  }
  return { ...(markdownEntry.date !== undefined && { date: markdownEntry.date }), markdown: markdownEntry.markdown };
}

/**
 * Returns every version's public release notes, newest first. Reads `.meta/changelog.json` when it is present and well
 * formed, keeping the sections whose audience is `all` and omitting a version that has none; otherwise reads every
 * version section of `CHANGELOG.md`, unfiltered.
 */
export function readReleaseNotes({ cwd = process.cwd() }: ReadReleaseNotesOptions = {}): ReleaseNotesEntry[] {
  const jsonEntries = readChangelogJson(cwd);
  if (jsonEntries === undefined) {
    return readChangelogMarkdown(cwd);
  }
  return jsonEntries.flatMap((entry) => {
    const notes = buildJsonReleaseNotes(entry);
    return notes === undefined ? [] : [{ version: entry.version, ...notes }];
  });
}

// region | Helpers

/**
 * Builds the release notes of the entry's public sections, or `undefined` when it has none. The markdown follows
 * release-kit's `renderReleaseNotesSingle` without its heading and breaking marker.
 */
function buildJsonReleaseNotes(entry: ChangelogJsonEntry): BuildInfo['releaseNotes'] {
  const sections = entry.sections
    .filter((section) => section.audience === 'all')
    .map(({ items, title }) => ({
      title,
      items: items.map(({ body, description }) => ({
        description,
        ...(body !== undefined && body.length > 0 && { body }),
      })),
    }));
  if (sections.length === 0) {
    return undefined;
  }

  const lines: string[] = [];
  for (const section of sections) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(`### ${section.title}`, '');
    for (const [index, item] of section.items.entries()) {
      lines.push(`- ${item.description}`);
      if (item.body !== undefined) {
        lines.push('', ...indentBodyLines(item.body));
        if (index < section.items.length - 1) {
          lines.push('');
        }
      }
    }
  }

  return { date: entry.date, markdown: lines.join('\n'), sections };
}

/** Indents each non-empty line of a body by two spaces, nesting it under its bullet. */
function indentBodyLines(body: string): string[] {
  return body.split('\n').map((line) => (line.length === 0 ? '' : `  ${line}`));
}

/** Reports whether a value has the shape of a changelog entry, as far as release notes read it. */
function isChangelogJsonEntry(value: unknown): value is ChangelogJsonEntry {
  return (
    isRecord(value) &&
    typeof value['version'] === 'string' &&
    typeof value['date'] === 'string' &&
    Array.isArray(value['sections']) &&
    value['sections'].every(
      (section) =>
        isRecord(section) &&
        typeof section['title'] === 'string' &&
        typeof section['audience'] === 'string' &&
        Array.isArray(section['items']) &&
        section['items'].every(
          (item) =>
            isRecord(item) &&
            typeof item['description'] === 'string' &&
            (item['body'] === undefined || typeof item['body'] === 'string'),
        ),
    )
  );
}

/**
 * Reads the well-formed entries of `.meta/changelog.json`, or `undefined` when the file is missing or does not hold an
 * array. A malformed entry is skipped.
 */
function readChangelogJson(cwd: string): ChangelogJsonEntry[] | undefined {
  const parsed = readJson(path.join(cwd, '.meta', 'changelog.json'));
  return Array.isArray(parsed) ? parsed.filter(isChangelogJsonEntry) : undefined;
}

/** Reads every version section of `CHANGELOG.md` in file order, omitting an empty one; none when the file is missing. */
function readChangelogMarkdown(cwd: string): ReleaseNotesEntry[] {
  const content = readText(path.join(cwd, 'CHANGELOG.md'));
  if (content === undefined) {
    return [];
  }

  const sections: Array<{ version: string; date: string | undefined; lines: string[] }> = [];
  let current: (typeof sections)[number] | undefined;
  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      const match = VERSION_HEADING_PATTERN.exec(line);
      current = match?.[1] === undefined ? undefined : { version: match[1], date: match[2], lines: [] };
      if (current !== undefined) {
        sections.push(current);
      }
    } else {
      current?.lines.push(line);
    }
  }

  return sections.flatMap(({ date, lines, version }) => {
    const markdown = lines.join('\n').trim();
    return markdown.length === 0 ? [] : [{ version, ...(date !== undefined && { date }), markdown }];
  });
}

/** Reads and parses a JSON file, or returns `undefined` when it is missing or unparseable. */
function readJson(filePath: string): unknown {
  const content = readText(filePath);
  if (content === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

/** Reads a text file, or returns `undefined` when it cannot be read. */
function readText(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

// endregion | Helpers
