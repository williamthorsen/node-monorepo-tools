import { defineConfig } from '@williamthorsen/nmr/config';

export default defineConfig({
  rootScripts: {
    'check:content': 'codeassembly validate --content packages/nmr/agents',
    'check:strict:post': ['check:content'],
  },
});
