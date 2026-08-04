import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { syncLabelsWorkflow } from '../packages/release-kit/src/sync-labels/templates.ts';

const repoRoot = join(import.meta.dirname, '..');
const workflowsDir = join(repoRoot, '.github', 'workflows');

/**
 * This repo dogfoods the workflow templates its own packages scaffold, so each caller workflow here must be the
 * template's output verbatim -- the same identity the kits enforce in consumer repos. Comparing content rather
 * than hashes is deliberate: a failure shows which lines drifted, where a digest mismatch shows nothing.
 */
describe('repo workflows match the templates its packages ship', () => {
  it('sync-labels.yaml matches release-kit syncLabelsWorkflow()', () => {
    const content = readFileSync(join(workflowsDir, 'sync-labels.yaml'), 'utf8');

    expect(content, 'Run `release-kit sync-labels init --force` to regenerate .github/workflows/sync-labels.yaml').toBe(
      syncLabelsWorkflow(),
    );
  });

  it('audit.yaml matches the v11y-check audit template', () => {
    const content = readFileSync(join(workflowsDir, 'audit.yaml'), 'utf8');
    const template = readFileSync(join(repoRoot, 'packages', 'v11y-check', 'templates', 'audit.yaml.template'), 'utf8');

    expect(content, 'Replace .github/workflows/audit.yaml with v11y-check templates/audit.yaml.template').toBe(
      template,
    );
  });
});
