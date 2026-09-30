import type { RepoType } from './detectRepoType.ts';

/** Generates the `.config/release-kit.config.ts` starter config, with commented-out options to customize. */
export function releaseConfigScript(repoType: RepoType): string {
  if (repoType === 'monorepo') {
    return `import { defineConfig } from '@williamthorsen/release-kit/config';

export default defineConfig({
  releaseNotes: {
    shouldInjectIntoReadme: true,
  },

  // Uncomment to exclude workspaces from release processing:
  // workspaces: [
  //   { dir: 'my-package', shouldExclude: true },
  // ],

  // Formatting: prettier is auto-detected. Set formatCommand to override.

  // Uncomment to override the default version patterns:
  // versionPatterns: { major: ['!'], minor: ['feat', 'feature'] },

  // Uncomment to add custom work types (merged with defaults):
  // workTypes: { perf: { header: 'Performance' } },
});
`;
  }

  return `import { defineConfig } from '@williamthorsen/release-kit/config';

export default defineConfig({
  releaseNotes: {
    shouldInjectIntoReadme: true,
  },

  // Formatting: prettier is auto-detected. Set formatCommand to override.

  // Uncomment to override the default version patterns:
  // versionPatterns: { major: ['!'], minor: ['feat', 'feature'] },

  // Uncomment to add custom work types (merged with defaults):
  // workTypes: { perf: { header: 'Performance' } },
});
`;
}

/**
 * Generates the publish.yaml GitHub Actions entry-point workflow.
 *
 * The caller's `permissions` block caps what the reusable workflow receives, so it must grant the `id-token: write`
 * that OIDC publishing needs.
 */
export function publishWorkflow(repoType: RepoType): string {
  const tagPattern = repoType === 'monorepo' ? "'*-v[0-9]*.[0-9]*.[0-9]*'" : "'v[0-9]*.[0-9]*.[0-9]*'";

  return `# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json
name: Publish

on:
  push:
    tags:
      - ${tagPattern}

permissions:
  id-token: write
  contents: read

jobs:
  publish:
    uses: williamthorsen/node-monorepo-tools/.github/workflows/publish.reusable.yaml@workflow/publish-v1
    with:
      provenance: true
      tags: \${{ github.ref_name }}
`;
}

/** Generates the create-github-release.yaml GitHub Actions caller workflow. */
export function createGithubReleaseWorkflow(repoType: RepoType): string {
  const tagPattern = repoType === 'monorepo' ? "'*-v[0-9]*.[0-9]*.[0-9]*'" : "'v[0-9]*.[0-9]*.[0-9]*'";

  return `# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json
name: Create GitHub Release

on:
  push:
    tags:
      - ${tagPattern}

permissions:
  contents: write

jobs:
  create-github-release:
    uses: williamthorsen/node-monorepo-tools/.github/workflows/create-github-release.reusable.yaml@workflow/create-github-release-v1
    with:
      tag: \${{ github.ref_name }}
`;
}

/** Generates the release.yaml GitHub Actions workflow. */
export function releaseWorkflow(repoType: RepoType): string {
  if (repoType === 'monorepo') {
    return `# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json
name: Release

on:
  workflow_dispatch:
    inputs:
      only:
        description: 'Workspaces to release (comma-separated, leave empty for all)'
        required: false
        type: string
      bump:
        description: 'Version bump type (auto detects it from commits)'
        required: false
        type: choice
        default: auto
        options:
          - auto
          - patch
          - minor
          - major
      force:
        description: 'Force a release even when there are not any commits, or any bump-worthy commits, since the last release (defaults to patch; combine with --bump for a different level)'
        required: false
        type: boolean
        default: false

permissions:
  contents: write
  packages: read

jobs:
  release:
    uses: williamthorsen/node-monorepo-tools/.github/workflows/release.reusable.yaml@workflow/release-v1
    with:
      only: \${{ inputs.only }}
      bump: \${{ inputs.bump != 'auto' && inputs.bump || '' }}
      force: \${{ inputs.force }}
`;
  }

  return `# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json
name: Release

on:
  workflow_dispatch:
    inputs:
      bump:
        description: 'Version bump type (auto detects it from commits)'
        required: false
        type: choice
        default: auto
        options:
          - auto
          - patch
          - minor
          - major
      force:
        description: 'Force a release even when there are not any commits, or any bump-worthy commits, since the last release (defaults to patch; combine with --bump for a different level)'
        required: false
        type: boolean
        default: false

permissions:
  contents: write
  packages: read

jobs:
  release:
    uses: williamthorsen/node-monorepo-tools/.github/workflows/release.reusable.yaml@workflow/release-v1
    with:
      bump: \${{ inputs.bump != 'auto' && inputs.bump || '' }}
      force: \${{ inputs.force }}
`;
}
