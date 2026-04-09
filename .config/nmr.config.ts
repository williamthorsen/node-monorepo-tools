import { defineConfig } from '@williamthorsen/nmr';

/** nmr configuration for this monorepo. */
export default defineConfig({
  rootScripts: {
    build: ['build:workspaces', 'build:rdy'],
    'build:workspaces': 'pnpm --recursive exec nmr build',
    'build:rdy': 'rdy compile',
  },
});
