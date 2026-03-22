/**
 * Report monorepo dependency overrides after install.
 *
 * Resolve the report-overrides CLI from the package's installed location to
 * avoid hardcoding internal dist paths. Fall back to a direct path for the
 * bootstrap case where the package is linked but not yet built.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const cliFilename = 'cli-report-overrides.js';

// Derive CLI path from the package's resolved entry point.
function resolveFromPackage() {
  try {
    const require = createRequire(import.meta.url);
    const entryPath = require.resolve('@williamthorsen/node-monorepo-core');
    return join(dirname(entryPath), cliFilename);
  } catch {
    return null;
  }
}

const cliPath = resolveFromPackage() ?? join('packages', 'core', 'dist', 'esm', cliFilename);

if (existsSync(cliPath)) {
  await import(pathToFileURL(cliPath).href);
}
