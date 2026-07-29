import { defineConfig } from '@williamthorsen/nmr';

/** nmr configuration for this monorepo. */
export default defineConfig({
  rootScripts: {
    'build:post': 'rdy compile',
  },
  // Transitional (#523). nmr's default test scripts still name the retired `vitest.standalone.config.ts` and
  // `vitest.integration.config.ts` by path, so this repo selects Vitest projects itself until those defaults
  // are retired. This table is what #523 installs as the defaults, so it deletes this block rather than
  // reconciling it. `--passWithNoTests` covers a package with no integration tests: without it, a project
  // matching no files exits 1.
  workspaceScripts: {
    test: "pnpm exec vitest --project '!integration'",
    'test:all': 'pnpm exec vitest',
    'test:coverage': "pnpm exec vitest --project '!integration' --coverage",
    'test:integration': 'pnpm exec vitest --project integration --passWithNoTests',
    'test:watch': "pnpm exec vitest --project '!integration' --watch",
  },
});
