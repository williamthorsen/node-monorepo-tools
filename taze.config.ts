import { defineConfig } from '@williamthorsen/nmr/taze';

export default defineConfig({
  packageMode: {
    // Disallow major upgrades until the pinned Node.js version is changed; engines is set to >=24.
    '@types/node': 'minor',
    // Hold typescript at v6 until v7 supports type-aware linting.
    typescript: 'minor',
  },
});
