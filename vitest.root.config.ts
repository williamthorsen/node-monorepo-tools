/**
 * Vitest configuration for the monorepo's own root-level tests, excluding every workspace package.
 *
 * `startDir` locates the monorepo root from this file rather than from the working directory, so the exclusions
 * hold wherever the run is invoked from.
 */
import { defineRootVitestConfig } from '@williamthorsen/nmr/vitest';

export default defineRootVitestConfig({ startDir: import.meta.dirname });
