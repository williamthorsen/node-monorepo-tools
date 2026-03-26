import { mergeConfig } from 'vitest/config';

import baseConfig from '../../config/vitest.config.js';

export default mergeConfig(baseConfig, {
  test: {
    passWithNoTests: true, // core has no tests; remove when it acquires source
  },
});
