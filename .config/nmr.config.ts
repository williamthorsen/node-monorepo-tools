import { defineConfig } from '@williamthorsen/nmr/config';

/** nmr configuration for this monorepo. */
export default defineConfig({
  rootScripts: {
    'build:post': 'rdy compile',
  },
});
