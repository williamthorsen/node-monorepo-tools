import { defineConfig } from '@williamthorsen/nmr';

/** nmr configuration for this monorepo. */
export default defineConfig({
  rootScripts: {
    build: 'pnpm --recursive exec nmr build',
    'build:post': 'rdy compile',
  },
});
