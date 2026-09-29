import { createLinter } from 'actionlint';
import { describe, expect, it } from 'vitest';

import { releaseWorkflow } from '../templates.ts';

describe('releaseWorkflow under actionlint', () => {
  it.each(['monorepo', 'single-package'] as const)('reports no findings for the %s variant', async (repoType) => {
    const lint = await createLinter();

    const findings = lint(releaseWorkflow(repoType), '.github/workflows/release.yaml');

    expect(findings).toStrictEqual([]);
  });
});
