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
  // Uncomment to override the default version patterns:
  // versionPatterns: { major: ['!'], minor: ['feat', 'feature'] },
  // Uncomment to add custom work types (merged with defaults):
  // workTypes: { perf: { header: 'Performance' } },
  // TODO: Uncomment and adjust if you have a format command
  // formatCommand: 'npx prettier --write',
};

export default config;
`;
  }

  return `import type { ReleaseKitConfig } from '@williamthorsen/release-kit';

const config: ReleaseKitConfig = {
  // Uncomment to override the default version patterns:
  // versionPatterns: { major: ['!'], minor: ['feat', 'feature'] },
  // Uncomment to add custom work types (merged with defaults):
  // workTypes: { perf: { header: 'Performance' } },
  // TODO: Uncomment and adjust if you have a format command
  // formatCommand: 'npx prettier --write',
};

export default config;
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

permissions:
  contents: write
  packages: read

jobs:
  release:
    uses: williamthorsen/.github/.github/workflows/release-pnpm.yaml@v3
    with:
      only: \${{ inputs.only }}
      bump: \${{ inputs.bump }}
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

permissions:
  contents: write
  packages: read

jobs:
  release:
    uses: williamthorsen/.github/.github/workflows/release-pnpm.yaml@v3
    with:
      bump: \${{ inputs.bump }}
`;
}
