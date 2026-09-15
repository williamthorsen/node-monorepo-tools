import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert, describe, expect, it } from 'vitest';

import { DEFAULT_BREAKING_POLICIES, DEFAULT_WORK_TYPES } from '../defaults.ts';

const thisDir = dirname(fileURLToPath(import.meta.url));
const docPath = resolve(thisDir, '..', '..', 'docs', 'work-types.md');
const docContent = readFileSync(docPath, 'utf8');

interface DocWorkTypeRow {
  key: string;
  header: string;
  breakingPolicy: string;
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

  it('uses the canonical `!` policy for each work type', () => {
    for (const row of rows) {
      expect(row.breakingPolicy, `\`!\` policy for "${row.key}"`).toBe(DEFAULT_BREAKING_POLICIES[row.key]);
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
    // Capture the `key`, `Header`, and policy columns, skipping the tier and aliases columns.
    const rowMatch = /^\|\s*[^|]+\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|[^|]*\|\s*([^|]+?)\s*\|/.exec(line);
    if (rowMatch) {
      const [, key, header, policy] = rowMatch;
      if (key === undefined || header === undefined || policy === undefined) {
        continue;
      }
      inTable = true;
      // The policy cell bolds `required` for emphasis.
      rows.push({ key, header: header.trim(), breakingPolicy: policy.replaceAll('*', '') });
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
