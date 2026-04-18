import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_WORK_TYPES } from '../defaults.ts';

const thisDir = dirname(fileURLToPath(import.meta.url));
const readmePath = resolve(thisDir, '..', '..', 'README.md');
const readmeContent = readFileSync(readmePath, 'utf8');

interface ReadmeWorkTypeRow {
  key: string;
  header: string;
}

/** Parse the "Default work types" table from README.md and return its rows. */
function parseWorkTypesTable(): ReadmeWorkTypeRow[] {
  const heading = readmeContent.indexOf('### Default work types');
  if (heading === -1) {
    throw new Error('README.md is missing the "Default work types" section');
  }

  const afterHeading = readmeContent.slice(heading);
  const lines = afterHeading.split('\n');
  const rows: ReadmeWorkTypeRow[] = [];
  let inTable = false;

  for (const line of lines) {
    // A row looks like `| \`key\` | Header | aliases |`.
    const rowMatch = /^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|/.exec(line);
    if (rowMatch) {
      const [, key, header] = rowMatch;
      if (key === undefined || header === undefined) {
        continue;
      }
      inTable = true;
      rows.push({ key, header: header.trim() });
      continue;
    }
    if (inTable && line.trim() === '') {
      break;
    }
  }

  if (rows.length === 0) {
    throw new Error('README.md "Default work types" table has no rows');
  }
  return rows;
}

describe('README.md "Default work types" table alignment with DEFAULT_WORK_TYPES', () => {
  const rows = parseWorkTypesTable();
  const readmeKeys = rows.map((row) => row.key);
  const defaultKeys = Object.keys(DEFAULT_WORK_TYPES);

  it('documents every key defined in DEFAULT_WORK_TYPES', () => {
    expect(readmeKeys).toEqual(defaultKeys);
  });

  it('uses the canonical header for each non-skipped work type', () => {
    for (const row of rows) {
      const config = DEFAULT_WORK_TYPES[row.key];
      if (config === undefined) {
        expect.fail(`README.md lists key "${row.key}" that is not in DEFAULT_WORK_TYPES`);
      }
      // The `fmt` row uses "(skipped)" instead of the header because
      // cliff.toml.template skips fmt commits at the parser level.
      if (row.key === 'fmt') {
        expect(row.header).toBe('(skipped)');
        continue;
      }
      expect(row.header).toBe(config.header);
    }
  });
});
