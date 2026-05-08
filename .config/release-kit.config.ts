import type { ReleaseKitConfig } from '@williamthorsen/release-kit';

const config: ReleaseKitConfig = {
  formatCommand: 'npx prettier --write',
  releaseNotes: {
    shouldInjectIntoReadme: true,
  },
  retiredPackages: [{ name: '@williamthorsen/preflight', tagPrefix: 'preflight-v', successor: 'readyup' }],
  workspaces: [
    { dir: 'core', legacyIdentities: [{ name: '@williamthorsen/node-monorepo-core', tagPrefix: 'core-v' }] },
  ],
};

export default config;
