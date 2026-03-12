import { mergeConfig } from 'vite';

import esmConfig from './vite.config.ts';

// The panel won't load without this IIFE in the distribution bundle.

export default mergeConfig(esmConfig, {
  build: {
    emptyOutDir: false,
    rollupOptions: {
      input: 'src/content.ts',
      output: {
        entryFileNames: 'content.js',
        format: 'iife',
        inlineDynamicImports: true,
      },
    },
  },
  publicDir: false,
});
