import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import createReactPlugin from '@vitejs/plugin-react';
import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from '../../config/vitest.config.ts';

const thisDirPath = dirname(fileURLToPath(import.meta.url));

//The `include` values in this config replace the more general ones in the base config.

const config = defineConfig({
  plugins: [createReactPlugin()],
  resolve: {
    alias: { '@': resolve(thisDirPath, './src') },
  },
  test: {
    coverage: {
      include: ['src/**/*.{ts,tsx}'],
    },
    environment: 'jsdom',
    include: ['src/**/__tests__/*.test.{ts,tsx}'],
    setupFiles: ['vitest.setup.ts'],
  },
});

export default mergeConfig(baseConfig, config);
