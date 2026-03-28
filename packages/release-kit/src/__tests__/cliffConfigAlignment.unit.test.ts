import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';

import { DEFAULT_WORK_TYPES } from '../defaults.ts';
import { COMMIT_PREPROCESSOR_PATTERNS } from '../parseCommitMessage.ts';

const thisDir = dirname(fileURLToPath(import.meta.url));
const templatePath = resolve(thisDir, '..', '..', 'cliff.toml.template');
const templateContent = readFileSync(templatePath, 'utf8');

interface CommitParser {
  message: string;
  group: string;
}

interface CommitPreprocessor {
  pattern: string;
  replace: string;
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

/** Extract the commit_parsers array from the TOML [git] section. */
function getCommitParsers(): CommitParser[] {
  const git = getGitSection();
  const parsers = git.commit_parsers;
  if (!Array.isArray(parsers)) {
    throw new TypeError('cliff.toml.template is missing git.commit_parsers array');
  }

  return parsers.map((entry) => {
    if (!isRecord(entry) || typeof entry.message !== 'string' || typeof entry.group !== 'string') {
      throw new Error(`Invalid commit_parser entry: ${JSON.stringify(entry)}`);
    }
    return { message: entry.message, group: entry.group };
  });
}

/** Extract the commit_preprocessors array from the TOML [git] section. */
function getCommitPreprocessors(): CommitPreprocessor[] {
  const git = getGitSection();
  const preprocessors = git.commit_preprocessors;
  if (!Array.isArray(preprocessors)) {
    throw new TypeError('cliff.toml.template is missing git.commit_preprocessors array');
  }

  return preprocessors.map((entry) => {
    if (!isRecord(entry) || typeof entry.pattern !== 'string' || typeof entry.replace !== 'string') {
      throw new Error(`Invalid commit_preprocessor entry: ${JSON.stringify(entry)}`);
    }
    return { pattern: entry.pattern, replace: entry.replace };
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

  describe('every work type and alias is matched by a commit parser', () => {
    for (const { typeName, header } of expectedTypes) {
      it(`"${typeName}" is matched and grouped as "${header}"`, () => {
        const syntheticMessage = `${typeName}: test`;
        const matchingParser = parsers.find((parser) => new RegExp(parser.message).test(syntheticMessage));

        if (matchingParser === undefined) {
          expect.fail(`No commit parser matches "${syntheticMessage}"`);
        }
        expect(matchingParser.group).toBe(header);
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

describe('cliff.toml.template alignment with COMMIT_PREPROCESSOR_PATTERNS', () => {
  const tomlPreprocessors = getCommitPreprocessors();
  const tomlPatterns = tomlPreprocessors.map((p) => p.pattern);
  const tsPatterns = COMMIT_PREPROCESSOR_PATTERNS.map((r) => r.source);

  it('has the same number of preprocessor patterns in both locations', () => {
    expect(tsPatterns).toHaveLength(tomlPatterns.length);
  });

  for (const pattern of tsPatterns) {
    it(`TypeScript pattern "${pattern}" exists in cliff.toml.template`, () => {
      expect(tomlPatterns).toContain(pattern);
    });
  }

  for (const pattern of tomlPatterns) {
    it(`TOML pattern "${pattern}" exists in COMMIT_PREPROCESSOR_PATTERNS`, () => {
      expect(tsPatterns).toContain(pattern);
    });
  }
});
