import { defineRdyConfig } from 'readyup';

/** Readyup configuration for this monorepo. */
export default defineRdyConfig({
  // The checks in these packages will be run by `rdy run --packages`.
  packages: ['@williamthorsen/nmr', '@williamthorsen/release-kit', 'v11y-check'],
});
