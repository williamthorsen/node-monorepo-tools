import { defineRdyConfig } from 'readyup';

export default defineRdyConfig({
  // `rdy run --packages` runs the kit that each of these packages publishes.
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
