#!/usr/bin/env node
try {
  await import('../dist/esm/bin/v11y.js');
} catch (error) {
  if (error.code === 'ERR_MODULE_NOT_FOUND') {
    process.stderr.write('v11y: build output not found — run `pnpm run build` first\n');
  } else {
    process.stderr.write(`v11y: failed to load: ${error.message}\n`);
  }
  process.exit(1);
}
