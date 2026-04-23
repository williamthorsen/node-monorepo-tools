import type { ReleaseKitConfig } from '@williamthorsen/release-kit';

const config: ReleaseKitConfig = {
  formatCommand: 'npx prettier --write',
  releaseNotes: {
    shouldInjectIntoReadme: true,
  },
  workspaces: [
    { dir: 'core', legacyIdentities: [{ name: '@williamthorsen/node-monorepo-core', tagPrefix: 'core-v' }] },
  ],
};

export default config;
