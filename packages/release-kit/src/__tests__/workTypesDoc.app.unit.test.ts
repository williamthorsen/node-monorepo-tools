import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert, describe, expect, it } from 'vitest';

import { DEFAULT_WORK_TYPES } from '../defaults.ts';

const thisDir = dirname(fileURLToPath(import.meta.url));
const docPath = resolve(thisDir, '..', '..', 'docs', 'work-types.md');
const docContent = readFileSync(docPath, 'utf8');

interface DocWorkTypeRow {
  key: string;
  header: string;
}

describe('docs/work-types.md "Work types and tiers" table alignment with DEFAULT_WORK_TYPES', () => {
  const rows = parseWorkTypesTable();
  const docKeys = rows.map((row) => row.key);
  const defaultKeys = Object.keys(DEFAULT_WORK_TYPES);

  it('documents every key defined in DEFAULT_WORK_TYPES in canonical order', () => {
    expect(docKeys).toStrictEqual(defaultKeys);
  });

  it('uses the canonical header for each non-skipped work type', () => {
    for (const row of rows) {
      const config = DEFAULT_WORK_TYPES[row.key];
      assert(config !== undefined, `docs/work-types.md lists key "${row.key}" that is not in DEFAULT_WORK_TYPES`);
      // The `fmt` row uses "(excluded from changelog)" instead of the header because
      // `fmt` carries `excludedFromChangelog: true` and is skipped at the parser level.
      const expectedHeader = row.key === 'fmt' ? '(excluded from changelog)' : config.header;
      expect(row.header, `header for "${row.key}"`).toBe(expectedHeader);
    }
  });
});

// region | Helpers
/** Parse the "Work types and tiers" table from docs/work-types.md and return its rows. */
function parseWorkTypesTable(): DocWorkTypeRow[] {
  const heading = /^# Work types and tiers$/m.exec(docContent);
  if (heading === null) {
    throw new Error('docs/work-types.md is missing the "Work types and tiers" heading');
  }

  const afterHeading = docContent.slice(heading.index);
  const lines = afterHeading.split('\n');
  const rows: DocWorkTypeRow[] = [];
  let inTable = false;

  for (const line of lines) {
    // A row looks like `| Tier | \`key\` | Header | aliases | policy |`.
    // Capture only the `key` and `Header` columns by skipping the leading tier column.
    const rowMatch = /^\|\s*[^|]+\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|/.exec(line);
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
    throw new Error('docs/work-types.md "Work types and tiers" table has no rows');
  }
  return rows;
}
// endregion | Helpers
