import { describe, expect, it } from 'vitest';

import { publishWorkflow, releaseConfigScript, releaseWorkflow } from '../templates.ts';

describe(releaseConfigScript, () => {
  it('generates a ReleaseKitConfig for monorepo type', () => {
    const script = releaseConfigScript('monorepo');

    expect(script).toContain('ReleaseKitConfig');
    expect(script).toContain('components:');
    expect(script).toContain('shouldExclude');
    expect(script).toContain('workTypes:');
    expect(script).toContain("header: 'Performance'");
    expect(script).toContain('export default config');
  });

  it('generates a ReleaseKitConfig for single-package type', () => {
    const script = releaseConfigScript('single-package');

    expect(script).toContain('ReleaseKitConfig');
    expect(script).toContain('workTypes:');
    expect(script).toContain("header: 'Performance'");
    expect(script).toContain('export default config');
    expect(script).not.toContain('components');
  });

  it('uses header field for work type labels', () => {
    const mono = releaseConfigScript('monorepo');
    const single = releaseConfigScript('single-package');

    expect(mono).toContain('header:');
    expect(single).toContain('header:');
    expect(mono).not.toContain('heading:');
    expect(single).not.toContain('heading:');
  });
});

describe(publishWorkflow, () => {
  it('generates a monorepo workflow with wildcard tag pattern', () => {
    const workflow = publishWorkflow('monorepo');

    expect(workflow).toContain("'*-v[0-9]*'");
    expect(workflow).not.toContain("- 'v[0-9]*'");
    expect(workflow).toContain('publish.reusable.yaml@publish-workflow-v1');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('contents: read');
    expect(workflow).not.toContain('secrets:');
  });

  it('generates a single-package workflow with v-prefixed tag pattern', () => {
    const workflow = publishWorkflow('single-package');

    expect(workflow).toContain("'v[0-9]*'");
    expect(workflow).not.toContain("'*-v[0-9]*'");
    expect(workflow).toContain('publish.reusable.yaml@publish-workflow-v1');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('contents: read');
    expect(workflow).not.toContain('secrets:');
  });

  it.each(['monorepo', 'single-package'] as const)(
    'includes provenance: false with an explanatory comment (%s)',
    (repoType) => {
      const workflow = publishWorkflow(repoType);

      expect(workflow).toContain('provenance: false');
      expect(workflow).toContain('# Set to true for public repos to generate npm provenance attestations');
    },
  );
});

describe(releaseWorkflow, () => {
  it('generates a monorepo workflow with only input but no monorepo flag', () => {
    const workflow = releaseWorkflow('monorepo');

    expect(workflow).toContain('release.reusable.yaml@release-workflow-v1');
    expect(workflow).not.toContain('monorepo:');
    expect(workflow).toContain('only:');
    expect(workflow).toContain('inputs.only');
  });

  it('generates a single-package workflow without only input', () => {
    const workflow = releaseWorkflow('single-package');

    expect(workflow).toContain('release.reusable.yaml@release-workflow-v1');
    expect(workflow).not.toContain('monorepo:');
    expect(workflow).not.toContain('inputs.only');
  });

  it('does not include version inputs', () => {
    const mono = releaseWorkflow('monorepo');
    const single = releaseWorkflow('single-package');

    expect(mono).not.toContain('node-version:');
    expect(single).not.toContain('node-version:');
    expect(mono).not.toContain('pnpm-version:');
    expect(single).not.toContain('pnpm-version:');
  });
});
