import { defineRdyConfig } from 'readyup';

export default defineRdyConfig({
  // `rdy run --sources` runs the kits that each of these sources publishes.
  sources: [
    'github:williamthorsen/.github',
    'npm:@williamthorsen/eslint-config-typescript',
    'npm:@williamthorsen/nmr',
    'npm:@williamthorsen/release-kit',
    'npm:@williamthorsen/toolbelt.errors',
    'npm:@williamthorsen/toolbelt.filesystem',
    'npm:@williamthorsen/toolbelt.testing',
    'npm:@williamthorsen/toolbelt.vitest',
    'npm:@williamthorsen/tsconfig',
    'npm:codeassembly',
    'npm:readyup',
    'npm:v11y-check',
  ],
});
