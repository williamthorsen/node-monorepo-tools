import { defineConfig } from '@williamthorsen/release-kit';

export default defineConfig({
  formatCommand: 'npx prettier --write',
  releaseNotes: {
    shouldInjectIntoReadme: true,
  },
  repoLabels: {
    extends: ['common'],
    labels: {
      'scope:root': { color: '00ff96' },
      'scope:core': { color: '00ff96' },
      'scope:nmr': { color: '00ff96' },
      'scope:preflight': { color: '00ff96' },
      'scope:release-kit': { color: '00ff96' },
      'scope:v11y-check': { color: '00ff96' },
    },
  },
  retiredPackages: [{ name: '@williamthorsen/preflight', tagPrefix: 'preflight-v', successor: 'readyup' }],
  workspaces: [
    { dir: 'nmr-core', legacyIdentities: [{ name: '@williamthorsen/node-monorepo-core', tagPrefix: 'core-v' }] },
    { dir: 'v11y-check', legacyIdentities: [{ name: '@williamthorsen/audit-deps', tagPrefix: 'audit-deps-v' }] },
  ],
});
