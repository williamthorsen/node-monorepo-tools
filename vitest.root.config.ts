/**
 * Vitest configuration for the monorepo's own root-level tests, excluding every workspace package.
 *
 * This file sits at the monorepo root, so `import.meta.dirname` states the root rather than locating it. The
 * config therefore describes this repo no matter where the run was invoked from.
 */
import { defineRootVitestConfig } from '@williamthorsen/nmr/vitest';

export default defineRootVitestConfig({ monorepoRoot: import.meta.dirname });
