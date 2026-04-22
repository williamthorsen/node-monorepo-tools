import { describe, expect, it } from 'vitest';

import { createGithubReleaseWorkflow, publishWorkflow, releaseConfigScript, releaseWorkflow } from '../templates.ts';

describe(releaseConfigScript, () => {
  it('generates a ReleaseKitConfig for monorepo type', () => {
    const script = releaseConfigScript('monorepo');

    expect(script).toContain('ReleaseKitConfig');
    expect(script).toContain('workspaces:');
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
    expect(script).not.toContain('workspaces');
  });

  it('uses header field for work type labels', () => {
    const mono = releaseConfigScript('monorepo');
    const single = releaseConfigScript('single-package');

    expect(mono).toContain('header:');
    expect(single).toContain('header:');
    expect(mono).not.toContain('heading:');
    expect(single).not.toContain('heading:');
  });

  it.each(['monorepo', 'single-package'] as const)(
    'scaffolds releaseNotes.shouldInjectIntoReadme as true (%s)',
    (repoType) => {
      const script = releaseConfigScript(repoType);

      expect(script).toContain('releaseNotes: {');
      expect(script).toContain('shouldInjectIntoReadme: true');
    },
  );
});

describe(publishWorkflow, () => {
  it('generates a monorepo workflow with tightened tag pattern', () => {
    const workflow = publishWorkflow('monorepo');

    expect(workflow).toContain("'*-v[0-9]*.[0-9]*.[0-9]*'");
    expect(workflow).not.toContain("- 'v[0-9]*.[0-9]*.[0-9]*'");
    expect(workflow).toContain('publish.reusable.yaml@workflow/publish-v1');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('contents: read');
    expect(workflow).not.toContain('secrets:');
  });

  it('generates a single-package workflow with v-prefixed tightened tag pattern', () => {
    const workflow = publishWorkflow('single-package');

    expect(workflow).toContain("'v[0-9]*.[0-9]*.[0-9]*'");
    expect(workflow).not.toContain("'*-v[0-9]*.[0-9]*.[0-9]*'");
    expect(workflow).toContain('publish.reusable.yaml@workflow/publish-v1');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('contents: read');
    expect(workflow).not.toContain('secrets:');
  });

  it.each(['monorepo', 'single-package'] as const)('defaults to provenance: true (%s)', (repoType) => {
    const workflow = publishWorkflow(repoType);

    expect(workflow).toContain('provenance: true');
    expect(workflow).not.toContain('provenance: false');
  });

  it.each(['monorepo', 'single-package'] as const)(
    'passes tags: ${{ github.ref_name }} to the reusable workflow (%s)',
    (repoType) => {
      const workflow = publishWorkflow(repoType);

      expect(workflow).toContain('tags: ${{ github.ref_name }}');
    },
  );
});

describe(createGithubReleaseWorkflow, () => {
  it('generates a monorepo workflow with the monorepo tag pattern', () => {
    const workflow = createGithubReleaseWorkflow('monorepo');

    expect(workflow).toContain("'*-v[0-9]*.[0-9]*.[0-9]*'");
    expect(workflow).not.toContain("- 'v[0-9]*.[0-9]*.[0-9]*'");
    expect(workflow).toContain('create-github-release.reusable.yaml@workflow/create-github-release-v1');
    expect(workflow).toContain('contents: write');
    expect(workflow).toContain('tag: ${{ github.ref_name }}');
  });

  it('generates a single-package workflow with the v-prefixed tag pattern', () => {
    const workflow = createGithubReleaseWorkflow('single-package');

    expect(workflow).toContain("'v[0-9]*.[0-9]*.[0-9]*'");
    expect(workflow).not.toContain("'*-v[0-9]*.[0-9]*.[0-9]*'");
    expect(workflow).toContain('create-github-release.reusable.yaml@workflow/create-github-release-v1');
    expect(workflow).toContain('contents: write');
    expect(workflow).toContain('tag: ${{ github.ref_name }}');
  });

  it.each(['monorepo', 'single-package'] as const)(
    'does not request id-token or packages permissions (%s)',
    (repoType) => {
      const workflow = createGithubReleaseWorkflow(repoType);

      expect(workflow).not.toContain('id-token:');
      expect(workflow).not.toContain('packages:');
    },
  );
});

describe(releaseWorkflow, () => {
  it('generates a monorepo workflow with only input but no monorepo flag', () => {
    const workflow = releaseWorkflow('monorepo');

    expect(workflow).toContain('release.reusable.yaml@workflow/release-v1');
    expect(workflow).not.toContain('monorepo:');
    expect(workflow).toContain('only:');
    expect(workflow).toContain('inputs.only');
  });

  it('generates a single-package workflow without only input', () => {
    const workflow = releaseWorkflow('single-package');

    expect(workflow).toContain('release.reusable.yaml@workflow/release-v1');
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
