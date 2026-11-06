import { describe, expect, it } from 'vitest';

import { noLintShellOverride } from '../../.readyup/lib/root-scripts.ts';
import { buildRepo } from '../test-utils/fixture-repo.ts';
import { findKitCheck } from '../test-utils/findKitCheck.ts';
import { getDetail } from '../test-utils/getDetail.ts';

describe(noLintShellOverride, () => {
  it('passes when the repo does not have an nmr config', () => {
    const dir = buildRepo({ 'package.json': '{}' });

    expect(noLintShellOverride(dir)).toBe(true);
  });

  it('passes when the nmr config does not declare lint:shell', () => {
    const dir = buildRepo({
      '.config/nmr.config.ts':
        "export default defineConfig({ rootScripts: { 'lint:workflows': 'nmr-actionlint' } });\n",
    });

    expect(noLintShellOverride(dir)).toBe(true);
  });

  it.each([["'lint:shell': \"git ls-files -z '*.sh' | xargs -0 shellcheck\""], ['"lint:shell" : "shellcheck *.sh"']])(
    'reports a lint:shell override written as %s',
    (entry) => {
      const dir = buildRepo({
        '.config/nmr.config.ts': `export default defineConfig({ rootScripts: { ${entry} } });\n`,
      });

      expect(getDetail(noLintShellOverride(dir))).toBe('.config/nmr.config.ts: rootScripts.lint:shell');
    },
  );
});

describe('the lint:shell override check', () => {
  it('tells the repo to delete its entry', () => {
    expect(findKitCheck('.config/nmr.config.ts does not override lint:shell').fix).toContain(
      'Delete the `lint:shell` entry',
    );
  });
});
