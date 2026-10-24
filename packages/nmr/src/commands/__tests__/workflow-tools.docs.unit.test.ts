import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert, describe, expect, it } from 'vitest';

import { TOOL_PINS, type WorkflowTool } from '../workflow-tools.ts';

const thisDir = dirname(fileURLToPath(import.meta.url));
const docPath = resolve(thisDir, '..', '..', '..', 'docs', 'scripts.md');
const docContent = readFileSync(docPath, 'utf8');

const TOOLS: readonly WorkflowTool[] = ['actionlint', 'shellcheck'];

describe('docs/scripts.md "Workflow lint" alignment with TOOL_PINS', () => {
  const section = extractWorkflowLintSection();

  it.each(TOOLS)('names only the pinned version of %s', (tool) => {
    const documentedVersions = section
      .matchAll(new RegExp(String.raw`\b${tool} (\d+\.\d+\.\d+)\b`, 'g'))
      .map((match) => match[1])
      .toArray();

    expect(documentedVersions).toStrictEqual([TOOL_PINS[tool].version]);
  });
});

// region | Helpers

/** Returns the text of the "Workflow lint" section, up to the next heading. */
function extractWorkflowLintSection(): string {
  const start = docContent.indexOf('\n### Workflow lint\n');
  assert(start !== -1, 'docs/scripts.md does not contain a "### Workflow lint" section');
  const end = docContent.indexOf('\n#', start + 1);
  return docContent.slice(start, end === -1 ? undefined : end);
}

// endregion | Helpers
