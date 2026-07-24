import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from './.config/vitest/vitest.config.ts';

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
delete baseConfig.test?.coverage?.include;
/* eslint-enable @typescript-eslint/no-unsafe-member-access */

const config = defineConfig({
  test: {
    coverage: {
      include: [],
    },
    exclude: ['packages/**'],
  },
});

export default mergeConfig(baseConfig, config);
