#!/usr/bin/env node
try {
  await import('../dist/esm/bin/preflight.js');
} catch (error) {
  if (error.code === 'ERR_MODULE_NOT_FOUND') {
    process.stderr.write('preflight: build output not found — run `pnpm run build` first\n');
  } else {
    process.stderr.write(`preflight: failed to load: ${error.message}\n`);
  }
  process.exit(1);
}
