/**
 * Vitest configuration for the monorepo's own root-level tests, excluding every workspace package.
 *
 * This file is at the monorepo root, so `import.meta.dirname` is the root wherever the run starts.
 */
import path from 'node:path';

import { defineRootVitestConfig } from '@williamthorsen/nmr/vitest';

export default defineRootVitestConfig({
  monorepoRoot: import.meta.dirname,
  project: { setupFiles: [path.join(import.meta.dirname, 'vitest.setup.ts')] },
});
