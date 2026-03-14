import { describe, expect, it } from 'vitest';

import { releaseConfigScript, releaseWorkflow } from '../templates.ts';

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

describe(releaseWorkflow, () => {
  it('generates a monorepo workflow with only input but no monorepo flag', () => {
    const workflow = releaseWorkflow('monorepo');

    expect(workflow).toContain('release-pnpm.yaml@v2');
    expect(workflow).not.toContain('monorepo:');
    expect(workflow).toContain('only:');
    expect(workflow).toContain('inputs.only');
  });

  it('generates a single-package workflow without only input', () => {
    const workflow = releaseWorkflow('single-package');

    expect(workflow).toContain('release-pnpm.yaml@v2');
    expect(workflow).not.toContain('monorepo:');
    expect(workflow).not.toContain('inputs.only');
  });

  it('includes TODO for node and pnpm versions in both types', () => {
    const mono = releaseWorkflow('monorepo');
    const single = releaseWorkflow('single-package');

    expect(mono).toContain('# TODO:');
    expect(single).toContain('# TODO:');
    expect(mono).toContain('node-version:');
    expect(single).toContain('node-version:');
  });
});
