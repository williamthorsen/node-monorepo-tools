import { defineConfig } from '@williamthorsen/nmr';

/** nmr configuration for this monorepo. */
export default defineConfig({
  rootScripts: {
    'build:post': 'rdy compile',
  },
});
