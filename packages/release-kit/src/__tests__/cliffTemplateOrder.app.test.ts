import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';

import { stripGroupDecorations } from '../buildChangelogEntries.ts';
import { composeHeader, WORK_TYPES_DATA } from '../defaults.ts';

const thisDir = dirname(fileURLToPath(import.meta.url));
const templatePath = resolve(thisDir, '..', '..', 'cliff.toml.template');
const templateContent = readFileSync(templatePath, 'utf8');

interface CommitParser {
  message: string;
  group?: string;
  skip?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read the [git].commit_parsers array from the template. */
function getRawCommitParsers(): CommitParser[] {
  const config = parse(templateContent);
  const git = config.git;
  if (!isRecord(git)) {
    throw new Error('cliff.toml.template is missing [git] section');
  }
  const parsers = git.commit_parsers;
  if (!Array.isArray(parsers)) {
    throw new TypeError('cliff.toml.template is missing git.commit_parsers array');
  }
  return parsers.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid commit_parser entry: ${JSON.stringify(entry)}`);
    }
    if (typeof entry.message !== 'string') {
      throw new TypeError(`commit_parser entry has non-string message: ${JSON.stringify(entry)}`);
    }
    const result: CommitParser = { message: entry.message };
    if (typeof entry.group === 'string') {
      result.group = entry.group;
    }
    if (entry.skip === true) {
      result.skip = true;
    }
    return result;
  });
}

const HTML_COMMENT_PREFIX = /^<!--\s*(\d+)\s*-->/;

/** Extract the `<!-- NN -->` numeric prefix from a group string, or undefined when absent. */
function extractPrefixNumber(group: string): number | undefined {
  const match = HTML_COMMENT_PREFIX.exec(group);
  if (match === null) return undefined;
  return Number.parseInt(match[1] ?? '', 10);
}

describe('cliff.toml.template canonical-order encoding (drift detection)', () => {
  const allParsers = getRawCommitParsers();
  const groupParsers = allParsers.filter((p) => p.group !== undefined);

  it('every group string carries a 2-digit zero-padded `<!-- NN -->` prefix', () => {
    for (const parser of groupParsers) {
      expect(parser.group, 'group should be defined').toBeDefined();
      const match = /^<!--\s*(\d{2})\s*-->/.exec(parser.group ?? '');
      expect(match, `group "${parser.group ?? ''}" lacks a 2-digit hidden prefix`).not.toBeNull();
    }
  });

  it('numbering is per unique group, not per parser entry — all parsers routing to the same bare group share the same prefix', () => {
    const bareToPrefix = new Map<string, number>();
    for (const parser of groupParsers) {
      const group = parser.group ?? '';
      const bare = stripGroupDecorations(group);
      const prefix = extractPrefixNumber(group);
      expect(prefix, `group "${group}" has no numeric prefix`).toBeDefined();
      if (prefix === undefined) continue;
      const existing = bareToPrefix.get(bare);
      if (existing === undefined) {
        bareToPrefix.set(bare, prefix);
      } else {
        expect(
          prefix,
          `parser group "${group}" has prefix ${prefix} but a previous parser routing to "${bare}" used ${existing}`,
        ).toBe(existing);
      }
    }
  });

  it('the canonical order encoded in the template matches the JSON taxonomy', () => {
    // Build the expected list of "<emoji> <label>" headers in canonical order, skipping
    // entries that the template excludes from grouping (currently only `fmt`).
    const excludedKeys = new Set<string>();
    for (const entry of WORK_TYPES_DATA.types) {
      if (entry.excludedFromChangelog === true) {
        excludedKeys.add(entry.key);
      }
    }
    const expectedHeaders = WORK_TYPES_DATA.types
      .filter((entry) => !excludedKeys.has(entry.key))
      .map((entry) => composeHeader(entry));

    // Collect the unique decorated groups from the template, sorted by their numeric prefix.
    const seenBare = new Set<string>();
    const decoratedGroups: Array<{ prefix: number; bare: string; decorated: string }> = [];
    for (const parser of groupParsers) {
      const group = parser.group ?? '';
      const bare = group.replace(/^<!--[^>]*-->/, '').trim();
      if (seenBare.has(bare)) continue;
      seenBare.add(bare);
      const prefix = extractPrefixNumber(group);
      if (prefix === undefined) continue;
      decoratedGroups.push({ prefix, bare, decorated: group });
    }
    decoratedGroups.sort((a, b) => a.prefix - b.prefix);

    const templateOrderedHeaders = decoratedGroups.map((entry) => entry.bare);
    expect(templateOrderedHeaders).toStrictEqual(expectedHeaders);
  });

  it('skips `fmt` (the only excludedFromChangelog entry) at the parser level', () => {
    const fmtParser = allParsers.find(
      (parser) => typeof parser.message === 'string' && /[\\\\][\w\s|()?+*-]*fmt\b/.test(parser.message),
    );
    expect(fmtParser?.skip).toBe(true);
  });

  it('routes the new `drop` and `utility` parsers to their canonical groups', () => {
    const dropParser = groupParsers.find((parser) => parser.message.includes('drop'));
    expect(dropParser?.group).toBeDefined();
    expect(stripGroupDecorations(dropParser?.group ?? '')).toBe('Removed');

    const utilityParser = groupParsers.find((parser) => parser.message.includes('utility'));
    expect(utilityParser?.group).toBeDefined();
    expect(stripGroupDecorations(utilityParser?.group ?? '')).toBe('Internal features');
  });
});

describe('stripGroupDecorations', () => {
  it('strips a `<!-- NN -->` HTML comment prefix and emoji', () => {
    expect(stripGroupDecorations('<!-- 04 -->🐛 Bug fixes')).toBe('Bug fixes');
  });

  it('strips an HTML comment prefix even when no emoji follows', () => {
    expect(stripGroupDecorations('<!-- 14 -->Documentation')).toBe('Documentation');
  });

  it('strips a leading emoji even when no HTML comment is present', () => {
    expect(stripGroupDecorations('🎉 Features')).toBe('Features');
  });

  it('returns a bare name unchanged', () => {
    expect(stripGroupDecorations('Bug fixes')).toBe('Bug fixes');
  });
});
