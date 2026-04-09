import type { SyncLabelsConfig } from '@williamthorsen/release-kit';

const config: SyncLabelsConfig = {
  presets: ['common'],
  labels: [
    { name: 'scope:root', color: '00ff96', description: 'Monorepo root configuration' },
    { name: 'scope:audit', color: '00ff96', description: 'audit-deps package' },
    { name: 'scope:core', color: '00ff96', description: 'core package' },
    { name: 'scope:nmr', color: '00ff96', description: 'nmr package' },
    { name: 'scope:preflight', color: '00ff96', description: 'preflight package' },
    { name: 'scope:release-kit', color: '00ff96', description: 'release-kit package' },
  ],
};

export default config;
