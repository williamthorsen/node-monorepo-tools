import { defineConfig } from '@williamthorsen/nmr/config';

export default defineConfig({
  rootScripts: {
    // Validate nmr's own CodeAssembly content.
    'check:content': 'codeassembly validate --content packages/nmr/agents',
    'check:strict:post': 'nmr check:content',
  },
});
