import { defineConfig } from 'vite';
import createTsconfigPathsPlugin from 'vite-tsconfig-paths';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    // Automatically create aliases to match those definedi in `paths` in `tsconfig.json`.
    createTsconfigPathsPlugin(),
  ],
  server: {
    watch: {
      ignored: ['**/coverage/**'],
    },
  },
});
