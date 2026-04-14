import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';

import { DEFAULT_CHANGELOG_JSON_CONFIG } from '../defaults.ts';

const thisDir = dirname(fileURLToPath(import.meta.url));
const templatePath = resolve(thisDir, '..', '..', 'cliff.toml.template');
const templateContent = readFileSync(templatePath, 'utf8');

/** Groups in cliff.toml.template that are intended for all audiences (not dev-only). */
const ALL_AUDIENCE_GROUPS = new Set([
  'Bug fixes',
  'Deprecated',
  'Documentation',
  'Features',
  'Performance',
  'Refactoring',
  'Security',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Extract all unique group values from cliff.toml.template commit_parsers. */
function getTemplateGroups(): Set<string> {
  const config = parse(templateContent);
  const git = config.git;
  if (!isRecord(git)) {
    throw new Error('cliff.toml.template is missing [git] section');
  }

  const parsers = git.commit_parsers;
  if (!Array.isArray(parsers)) {
    throw new TypeError('cliff.toml.template is missing git.commit_parsers array');
  }

  const groups = new Set<string>();
  for (const entry of parsers) {
    if (isRecord(entry) && typeof entry.group === 'string') {
      groups.add(entry.group);
    }
  }
  return groups;
}

describe('devOnlySections drift detection', () => {
  const templateGroups = getTemplateGroups();
  const devOnlySections = new Set(DEFAULT_CHANGELOG_JSON_CONFIG.devOnlySections);

  it('every devOnlySections default exists as a group in cliff.toml.template', () => {
    for (const section of devOnlySections) {
      expect(templateGroups, `devOnlySections entry "${section}" not found in cliff.toml.template groups`).toContain(
        section,
      );
    }
  });

  it('every cliff.toml.template group is classified as either dev-only or all-audience', () => {
    for (const group of templateGroups) {
      const isClassified = devOnlySections.has(group) || ALL_AUDIENCE_GROUPS.has(group);
      expect(
        isClassified,
        `Group "${group}" in cliff.toml.template is not classified — add it to devOnlySections defaults or ALL_AUDIENCE_GROUPS`,
      ).toBe(true);
    }
  });

  it('no group appears in both devOnlySections and ALL_AUDIENCE_GROUPS', () => {
    for (const group of devOnlySections) {
      expect(
        ALL_AUDIENCE_GROUPS.has(group),
        `Group "${group}" appears in both devOnlySections and ALL_AUDIENCE_GROUPS`,
      ).toBe(false);
    }
  });
});
