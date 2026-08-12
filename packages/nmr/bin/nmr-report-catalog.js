#!/usr/bin/env node
try {
  await import('../dist/esm/cli-report-catalog.js');
} catch (error) {
  if (error.code === 'ERR_MODULE_NOT_FOUND') {
    process.stderr.write('nmr-report-catalog: build output not found — run `pnpm run bootstrap` first\n');
  } else {
    process.stderr.write(`nmr-report-catalog: failed to load: ${error.message}\n`);
  }
  process.exit(1);
}
