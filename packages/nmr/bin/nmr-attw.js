#!/usr/bin/env node
try {
  await import('../dist/esm/cli-attw.js');
} catch (error) {
  if (error.code === 'ERR_MODULE_NOT_FOUND') {
    process.stderr.write('nmr-attw: build output not found — run `pnpm run build` first\n');
  } else {
    process.stderr.write(`nmr-attw: failed to load: ${error.message}\n`);
  }
  process.exit(1);
}
