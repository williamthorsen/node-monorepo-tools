import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from './.config/vitest/vitest.config.ts';

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,unicorn/no-top-level-side-effects
delete baseConfig.test?.coverage?.include;

const config = defineConfig({
  test: {
    coverage: {
      include: [],
    },
    exclude: ['packages/**'],
  },
});

export default mergeConfig(baseConfig, config);
