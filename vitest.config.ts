/**
 * Vitest configuration for workspace packages.
 *
 * Each package resolves this ancestor config by walking up from its own directory; without it, that search escapes
 * the repo. Project roots default to the run root, so the shared config's globs scope to whichever package invoked
 * Vitest. The repo's own root-level tests use `vitest.root.config.ts`.
 */
import { defineVitestConfig } from '@williamthorsen/nmr/vitest';

export default defineVitestConfig();
