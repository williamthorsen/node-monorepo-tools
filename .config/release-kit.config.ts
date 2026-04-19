import type { ReleaseKitConfig } from '@williamthorsen/release-kit';

const config: ReleaseKitConfig = {
  formatCommand: 'npx prettier --write',
  releaseNotes: {
    shouldInjectIntoReadme: true,
  },
};

export default config;
