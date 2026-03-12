import createReactPlugin from '@vitejs/plugin-react';
import { mergeConfig } from 'vite';

import baseConfig from '../../vite.config.ts';

export default mergeConfig(baseConfig, {
  build: {
    emptyOutDir: true, // Clean the 'dist/' directory before each build
    // minify: false,
    modulePreload: {
      polyfill: false, // We don't care about older browsers that don't support module preload.
    },
    outDir: '../dist',
    rollupOptions: {
      input: {
        background: 'src/background.ts',
        index: 'src/index.html',
        loader: 'src/loader.html',
        panel: 'src/panel/index.html',
        sidebar: 'src/sidebar/index.html',
      },
      output: {
        entryFileNames: '[name].js',
        format: 'esm',
      },
    },
  },
  plugins: [createReactPlugin()],
  publicDir: '../public', // Files in this directory (relative to `root`) are copied to `outDir` when building.
  root: 'src',
  server: {
    port: 5180,
  },
});
