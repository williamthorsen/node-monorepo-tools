import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';

import { DEFAULT_WORK_TYPES } from '../defaults.ts';

const thisDir = dirname(fileURLToPath(import.meta.url));
const templatePath = resolve(thisDir, '..', '..', 'cliff.toml.template');
const templateContent = readFileSync(templatePath, 'utf8');

interface CommitParser {
  message: string;
  group: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse the [git] section from cliff.toml.template with runtime validation. */
function getGitSection(): Record<string, unknown> {
  const config = parse(templateContent);
  const git = config.git;
  if (!isRecord(git)) {
    throw new Error('cliff.toml.template is missing [git] section');
  }
  return git;
}

/** Extract all raw commit_parsers entries from the TOML [git] section. */
function getRawCommitParsers(): Array<Record<string, unknown>> {
  const git = getGitSection();
  const parsers = git.commit_parsers;
  if (!Array.isArray(parsers)) {
    throw new TypeError('cliff.toml.template is missing git.commit_parsers array');
  }

  return parsers.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid commit_parser entry: ${JSON.stringify(entry)}`);
    }
    return entry;
  });
}

/** Extract only the group-mapping commit_parsers (skip entries excluded). */
function getCommitParsers(): CommitParser[] {
  return getRawCommitParsers()
    .filter((entry) => entry.skip !== true)
    .map((entry) => {
      if (typeof entry.message !== 'string' || typeof entry.group !== 'string') {
        throw new TypeError(`Invalid commit_parser entry: ${JSON.stringify(entry)}`);
      }
      return { message: entry.message, group: entry.group };
    });
}

/** Collect all type names and aliases from DEFAULT_WORK_TYPES, each paired with its expected header. */
function getExpectedTypes(): Array<{ typeName: string; header: string }> {
  const entries: Array<{ typeName: string; header: string }> = [];
  for (const [key, config] of Object.entries(DEFAULT_WORK_TYPES)) {
    entries.push({ typeName: key, header: config.header });
    for (const alias of config.aliases ?? []) {
      entries.push({ typeName: alias, header: config.header });
    }
  }
  return entries;
}

/** Collect all unique header values from DEFAULT_WORK_TYPES. */
function getKnownHeaders(): Set<string> {
  return new Set(Object.values(DEFAULT_WORK_TYPES).map((config) => config.header));
}

describe('cliff.toml.template alignment with DEFAULT_WORK_TYPES', () => {
  const parsers = getCommitParsers();
  const expectedTypes = getExpectedTypes();
  const knownHeaders = getKnownHeaders();

  /** Assert that a synthetic commit message is matched by a parser and grouped under the expected header. */
  function assertParsedAs(message: string, expectedGroup: string): void {
    const matchingParser = parsers.find((parser) => new RegExp(parser.message).test(message));
    if (matchingParser === undefined) {
      expect.fail(`No commit parser matches "${message}"`);
    }
    expect(matchingParser.group).toBe(expectedGroup);
  }

  describe('every work type is matched with GitHub-style ticket prefix', () => {
    for (const { typeName, header } of expectedTypes) {
      it(`"#1 ${typeName}: test" is matched and grouped as "${header}"`, () => {
        assertParsedAs(`#1 ${typeName}: test`, header);
      });
    }
  });

  describe('every work type is matched with Jira-style ticket prefix', () => {
    for (const { typeName, header } of expectedTypes) {
      it(`"PROJ-1 ${typeName}: test" is matched and grouped as "${header}"`, () => {
        assertParsedAs(`PROJ-1 ${typeName}: test`, header);
      });
    }
  });

  describe('every work type is matched in pipe-prefixed scope format', () => {
    for (const { typeName, header } of expectedTypes) {
      it(`"#1 scope|${typeName}: test" is matched and grouped as "${header}"`, () => {
        assertParsedAs(`#1 scope|${typeName}: test`, header);
      });
    }
  });

  describe('breaking variants are matched', () => {
    for (const { typeName, header } of expectedTypes) {
      it(`"#1 ${typeName}!: test" (breaking) is matched as "${header}"`, () => {
        assertParsedAs(`#1 ${typeName}!: test`, header);
      });

      it(`"#1 scope|${typeName}!: test" (pipe breaking) is matched as "${header}"`, () => {
        assertParsedAs(`#1 scope|${typeName}!: test`, header);
      });
    }
  });

  describe('sub-ticket variants are matched', () => {
    for (const { typeName, header } of expectedTypes) {
      it(`"#1.2 ${typeName}: test" (dot sub-ticket) is matched as "${header}"`, () => {
        assertParsedAs(`#1.2 ${typeName}: test`, header);
      });

      it(`"#1-2 ${typeName}: test" (dash sub-ticket) is matched as "${header}"`, () => {
        assertParsedAs(`#1-2 ${typeName}: test`, header);
      });
    }
  });

  describe('every commit parser group maps to a known work type header', () => {
    const uniqueGroups = [...new Set(parsers.map((p) => p.group))];
    for (const group of uniqueGroups) {
      it(`group "${group}" corresponds to a DEFAULT_WORK_TYPES header`, () => {
        expect(knownHeaders).toContain(group);
      });
    }
  });
});

describe('cliff.toml.template skip rules', () => {
  const rawParsers = getRawCommitParsers();
  const skipParsers = rawParsers.filter((entry) => entry.skip === true);
  const groupParsers = getCommitParsers();

  it('includes a catch-all `.*` skip rule', () => {
    const catchAll = skipParsers.find((entry) => entry.message === '.*');
    expect(catchAll).toBeDefined();
  });

  it('places the catch-all `.*` skip rule last in commit_parsers', () => {
    const lastEntry = rawParsers.at(-1);
    expect(lastEntry).toMatchObject({ message: '.*', skip: true });
  });

  it('includes a skip rule for merge commits', () => {
    const mergeSkip = skipParsers.find(
      (entry) => typeof entry.message === 'string' && new RegExp(entry.message).test('Merge pull request #1'),
    );
    expect(mergeSkip).toBeDefined();
  });

  it('does not match unticketed commits against any group-mapping parser', () => {
    const untimedMessages = [
      'feat: Add new feature',
      'scope|fix: Fix bug',
      'tooling: Generate repo labels',
      'chore: bump deps',
      'Update readme',
      'wip stuff',
    ];

    for (const message of untimedMessages) {
      const match = groupParsers.find((parser) => new RegExp(parser.message).test(message));
      expect(match, `"${message}" unexpectedly matched group "${match?.group}"`).toBeUndefined();
    }
  });
});
