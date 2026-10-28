import { describe, expect, it } from 'vitest';

import {
  renderCreateGithubReleaseWorkflow,
  renderPublishWorkflow,
  renderReleaseConfigScript,
  renderReleaseWorkflow,
} from '../templates.ts';

describe(renderReleaseConfigScript, () => {
  it('generates a defineConfig-wrapped config for monorepo type', () => {
    const script = renderReleaseConfigScript('monorepo');

    expect(script).toContain("import { defineConfig } from '@williamthorsen/release-kit/config'");
    expect(script).toContain('workspaces:');
    expect(script).toContain('shouldExclude');
    expect(script).toContain('workTypes:');
    expect(script).toContain("header: 'Performance'");
    expect(script).toContain('export default defineConfig({');
  });

  it('generates a defineConfig-wrapped config for single-package type', () => {
    const script = renderReleaseConfigScript('single-package');

    expect(script).toContain("import { defineConfig } from '@williamthorsen/release-kit/config'");
    expect(script).toContain('workTypes:');
    expect(script).toContain("header: 'Performance'");
    expect(script).toContain('export default defineConfig({');
    expect(script).not.toContain('workspaces');
  });

  it('uses header field for work type labels', () => {
    const monorepoScript = renderReleaseConfigScript('monorepo');
    const singlePackageScript = renderReleaseConfigScript('single-package');

    expect(monorepoScript).toContain('header:');
    expect(singlePackageScript).toContain('header:');
    expect(monorepoScript).not.toContain('heading:');
    expect(singlePackageScript).not.toContain('heading:');
  });

  it.each(['monorepo', 'single-package'] as const)(
    'scaffolds releaseNotes.shouldInjectIntoReadme as true (%s)',
    (repoType) => {
      const script = renderReleaseConfigScript(repoType);

      expect(script).toContain('releaseNotes: {');
      expect(script).toContain('shouldInjectIntoReadme: true');
    },
  );
});

describe(renderPublishWorkflow, () => {
  it('generates a monorepo workflow with tightened tag pattern', () => {
    const workflow = renderPublishWorkflow('monorepo');

    expect(workflow).toContain("'*-v[0-9]*.[0-9]*.[0-9]*'");
    expect(workflow).not.toContain("- 'v[0-9]*.[0-9]*.[0-9]*'");
    expect(workflow).toContain('publish.reusable.yaml@workflow/publish-v1');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('contents: read');
    expect(workflow).not.toContain('secrets:');
  });

  it('generates a single-package workflow with v-prefixed tightened tag pattern', () => {
    const workflow = renderPublishWorkflow('single-package');

    expect(workflow).toContain("'v[0-9]*.[0-9]*.[0-9]*'");
    expect(workflow).not.toContain("'*-v[0-9]*.[0-9]*.[0-9]*'");
    expect(workflow).toContain('publish.reusable.yaml@workflow/publish-v1');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('contents: read');
    expect(workflow).not.toContain('secrets:');
  });

  it.each(['monorepo', 'single-package'] as const)('defaults to provenance: true (%s)', (repoType) => {
    const workflow = renderPublishWorkflow(repoType);

    expect(workflow).toContain('provenance: true');
    expect(workflow).not.toContain('provenance: false');
  });

  it.each(['monorepo', 'single-package'] as const)('omits provenance when provenance is false (%s)', (repoType) => {
    const workflow = renderPublishWorkflow(repoType, { shouldGenerateProvenance: false });

    expect(workflow).not.toContain('provenance');
    expect(workflow).toContain('    with:\n      tags: ${{ github.ref_name }}\n');
  });

  it.each(['monorepo', 'single-package'] as const)(
    'passes tags: ${{ github.ref_name }} to the reusable workflow (%s)',
    (repoType) => {
      const workflow = renderPublishWorkflow(repoType);

      expect(workflow).toContain('tags: ${{ github.ref_name }}');
    },
  );
});

describe(renderCreateGithubReleaseWorkflow, () => {
  it('generates a monorepo workflow with the monorepo tag pattern', () => {
    const workflow = renderCreateGithubReleaseWorkflow('monorepo');

    expect(workflow).toContain("'*-v[0-9]*.[0-9]*.[0-9]*'");
    expect(workflow).not.toContain("- 'v[0-9]*.[0-9]*.[0-9]*'");
    expect(workflow).toContain('create-github-release.reusable.yaml@workflow/create-github-release-v1');
    expect(workflow).toContain('contents: write');
    expect(workflow).toContain('tag: ${{ github.ref_name }}');
  });

  it('generates a single-package workflow with the v-prefixed tag pattern', () => {
    const workflow = renderCreateGithubReleaseWorkflow('single-package');

    expect(workflow).toContain("'v[0-9]*.[0-9]*.[0-9]*'");
    expect(workflow).not.toContain("'*-v[0-9]*.[0-9]*.[0-9]*'");
    expect(workflow).toContain('create-github-release.reusable.yaml@workflow/create-github-release-v1');
    expect(workflow).toContain('contents: write');
    expect(workflow).toContain('tag: ${{ github.ref_name }}');
  });

  it.each(['monorepo', 'single-package'] as const)(
    'does not request id-token or packages permissions (%s)',
    (repoType) => {
      const workflow = renderCreateGithubReleaseWorkflow(repoType);

      expect(workflow).not.toContain('id-token:');
      expect(workflow).not.toContain('packages:');
    },
  );
});

describe(renderReleaseWorkflow, () => {
  it('generates a monorepo workflow with an only input and without a monorepo flag', () => {
    const workflow = renderReleaseWorkflow('monorepo');

    expect(workflow).toContain('release.reusable.yaml@workflow/release-v1');
    expect(workflow).not.toContain('monorepo:');
    expect(workflow).toContain('only:');
    expect(workflow).toContain('inputs.only');
  });

  it('generates a single-package workflow without only input', () => {
    const workflow = renderReleaseWorkflow('single-package');

    expect(workflow).toContain('release.reusable.yaml@workflow/release-v1');
    expect(workflow).not.toContain('monorepo:');
    expect(workflow).not.toContain('inputs.only');
  });

  it.each(['monorepo', 'single-package'] as const)(
    'offers auto as the default bump and passes it on as an empty bump (%s)',
    (repoType) => {
      const workflow = renderReleaseWorkflow(repoType);

      expect(workflow).toContain('default: auto\n        options:\n          - auto\n          - patch');
      expect(workflow).not.toContain("- ''");
      expect(workflow).toContain("bump: ${{ inputs.bump != 'auto' && inputs.bump || '' }}");
    },
  );

  it('does not include version inputs', () => {
    const monorepoWorkflow = renderReleaseWorkflow('monorepo');
    const singlePackageWorkflow = renderReleaseWorkflow('single-package');

    expect(monorepoWorkflow).not.toContain('node-version:');
    expect(singlePackageWorkflow).not.toContain('node-version:');
    expect(monorepoWorkflow).not.toContain('pnpm-version:');
    expect(singlePackageWorkflow).not.toContain('pnpm-version:');
  });
});
