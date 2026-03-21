import { defineConfig } from '@williamthorsen/node-monorepo-core';

/**
 * nmr configuration for this monorepo.
 *
 * Intentionally present to dogfood nmr's config-loading feature: the file
 * exercises the `defineConfig` API and verifies that nmr discovers and loads
 * `.config/nmr.config.ts` at startup. The built-in defaults already match
 * this repo's conventions; override `rootScripts` or `workspaceScripts` here
 * to customize.
 */
export default defineConfig({});
