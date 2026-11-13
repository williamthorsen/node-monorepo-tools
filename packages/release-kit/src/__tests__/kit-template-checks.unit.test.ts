import { join } from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it } from 'vitest';

import { fileMatchesTemplate } from '../../.readyup/lib/template-checks.ts';

const TEMPLATE = 'name: Release\non: push\njobs:\n  release:\n    uses: org/repo@workflow/release-v1\n';

describe(fileMatchesTemplate, () => {
  it('passes when the file equals the template', () => {
    const filePath = writeWorkflow(TEMPLATE);

    expect(fileMatchesTemplate(filePath, TEMPLATE)).toStrictEqual({ ok: true });
  });

  it('names the differing hunks when the file differs from the template', () => {
    const filePath = writeWorkflow(TEMPLATE.replace('release-v1', 'release-v0'));

    const outcome = fileMatchesTemplate(filePath, TEMPLATE);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toMatch(new RegExp(`^${filePath} differs from the template:\n@@ `));
    expect(outcome.detail).toContain('\n-    uses: org/repo@workflow/release-v0');
    expect(outcome.detail).toContain('\n+    uses: org/repo@workflow/release-v1');
  });

  it('reports a missing file', () => {
    const tree = disposeOnTestFinished(createTempTree({}, { prefix: 'release-kit-template-' }));
    const filePath = join(tree.dir, 'release.yaml');

    expect(fileMatchesTemplate(filePath, TEMPLATE)).toStrictEqual({ ok: false, detail: `${filePath} is missing` });
  });

  it('reports a file that cannot be read', () => {
    const tree = disposeOnTestFinished(
      createTempTree({ 'release.yaml/.keep': '' }, { prefix: 'release-kit-template-' }),
    );
    const filePath = join(tree.dir, 'release.yaml');

    const outcome = fileMatchesTemplate(filePath, TEMPLATE);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toMatch(new RegExp(`^${filePath} could not be read: `));
  });
});

// region | Helpers
/** Writes a workflow file to a temp tree and returns its absolute path. */
function writeWorkflow(content: string): string {
  const tree = disposeOnTestFinished(createTempTree({ 'release.yaml': content }, { prefix: 'release-kit-template-' }));
  return join(tree.dir, 'release.yaml');
}
// endregion | Helpers
