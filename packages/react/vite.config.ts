import createReactPlugin from '@vitejs/plugin-react';
import { mergeConfig } from 'vite';

import baseConfig from '../../vite.config.ts';

// https://vitejs.dev/config/
export default mergeConfig(baseConfig, {
  plugins: [createReactPlugin()],
  server: {
    port: 5176,
  },
});
