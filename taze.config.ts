import { defineConfig } from '@williamthorsen/nmr/taze';

/**
 * Dependency-upgrade configuration for this monorepo. The release-soak policy comes from nmr; what is
 * declared here is only what is specific to this repo.
 */
export default defineConfig({
  // Hold packages that must track a particular version line, so an upgrade pass never jumps them.
  packageMode: {
    // Hold @types/node at the minimum-supported Node major (24); engines is >=24.
    '@types/node': 'minor',
    // Hold typescript below 7, which ships no compiler API for nmr-compile to build against and cannot
    // back typescript-eslint's type-aware linting.
    typescript: 'minor',
  },
});
