import type { RepoType } from './detectRepoType.ts';

/**
 * Generate the `.config/release-kit.config.ts` starter config with TODOs for customization.
 *
 * Uses the new `ReleaseKitConfig` shape with `header` field for work type labels.
 */
export function releaseConfigScript(repoType: RepoType): string {
  if (repoType === 'monorepo') {
    return `import type { ReleaseKitConfig } from '@williamthorsen/release-kit';

const config: ReleaseKitConfig = {
  // Uncomment to exclude components from release processing:
  // components: [
  //   { dir: 'my-package', shouldExclude: true },
  // ],

  // Formatting: prettier is auto-detected. Set formatCommand to override.

  // Uncomment to override the default version patterns:
  // versionPatterns: { major: ['!'], minor: ['feat', 'feature'] },

  // Uncomment to add custom work types (merged with defaults):
  // workTypes: { perf: { header: 'Performance' } },
};

export default config;
`;
  }

  return `import type { ReleaseKitConfig } from '@williamthorsen/release-kit';

const config: ReleaseKitConfig = {
  // Formatting: prettier is auto-detected. Set formatCommand to override.

  // Uncomment to override the default version patterns:
  // versionPatterns: { major: ['!'], minor: ['feat', 'feature'] },

  // Uncomment to add custom work types (merged with defaults):
  // workTypes: { perf: { header: 'Performance' } },
};

export default config;
`;
}

/**
 * Generate the publish.yaml GitHub Actions entry-point workflow.
 *
 * The `permissions` block is present for explicitness; the reusable workflow declares its own
 * permissions, so GitHub uses those rather than the caller's block.
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
`;
}

/** Generate the release.yaml GitHub Actions workflow. */
export function releaseWorkflow(repoType: RepoType): string {
  if (repoType === 'monorepo') {
    return `# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json
name: Release

on:
  workflow_dispatch:
    inputs:
      only:
        description: 'Components to release (comma-separated, leave empty for all)'
        required: false
        type: string
      bump:
        description: 'Override version bump type (leave empty to auto-detect from commits)'
        required: false
        type: choice
        options:
          - ''
          - patch
          - minor
          - major
      force:
        description: 'Force a release even when there are no commits since the last tag (requires --bump)'
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
      bump: \${{ inputs.bump }}
      force: \${{ inputs.force }}
`;
  }

  return `# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json
name: Release

on:
  workflow_dispatch:
    inputs:
      bump:
        description: 'Override version bump type (leave empty to auto-detect from commits)'
        required: false
        type: choice
        options:
          - ''
          - patch
          - minor
          - major
      force:
        description: 'Force a release even when there are no commits since the last tag (requires --bump)'
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
      bump: \${{ inputs.bump }}
      force: \${{ inputs.force }}
`;
}
