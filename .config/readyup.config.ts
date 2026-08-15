import { defineRdyConfig } from 'readyup';

/** Readyup configuration for this monorepo. */
export default defineRdyConfig({
  // The checks in these packages will be run by `rdy run --packages`.
  packages: [
    '@williamthorsen/eslint-config-typescript',
    '@williamthorsen/nmr',
    '@williamthorsen/release-kit',
    '@williamthorsen/toolbelt.errors',
    '@williamthorsen/toolbelt.vitest',
    '@williamthorsen/tsconfig',
    'codeassembly',
    'readyup',
    'v11y-check',
  ],
});
