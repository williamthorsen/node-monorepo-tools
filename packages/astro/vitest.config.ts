import assert from 'node:assert';

import { getViteConfig } from 'astro/config';
import { defineConfig, mergeConfig } from 'vitest/config';

import { baseConfig } from '../../config/vitest.config.js';

const config = defineConfig({
  test: {
    /* for example, use global to avoid globals imports (describe, test, expect): */
    // globals: true,
  },
});

assert.ok(typeof baseConfig !== 'function');
assert.ok(typeof config !== 'function');
export default getViteConfig(mergeConfig(baseConfig, config));
