import { defineConfig } from '@williamthorsen/release-kit';

export default defineConfig({
  formatCommand: 'npx prettier --write',
  releaseNotes: {
    shouldInjectIntoReadme: true,
  },
  repoLabels: {
    extends: ['common'],
    labels: {
      'scope:root': { color: '00ff96', description: 'Monorepo root configuration' },
      'scope:core': { color: '00ff96', description: 'core package' },
      'scope:nmr': { color: '00ff96', description: 'nmr package' },
      'scope:preflight': { color: '00ff96', description: 'preflight package' },
      'scope:release-kit': { color: '00ff96', description: 'release-kit package' },
      'scope:v11y-check': { color: '00ff96', description: 'v11y-check package' },
    },
  },
  retiredPackages: [{ name: '@williamthorsen/preflight', tagPrefix: 'preflight-v', successor: 'readyup' }],
  workspaces: [
    { dir: 'nmr-core', legacyIdentities: [{ name: '@williamthorsen/node-monorepo-core', tagPrefix: 'core-v' }] },
    { dir: 'v11y-check', legacyIdentities: [{ name: '@williamthorsen/audit-deps', tagPrefix: 'audit-deps-v' }] },
  ],
});
