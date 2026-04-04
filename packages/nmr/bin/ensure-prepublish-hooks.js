#!/usr/bin/env node
try {
  await import('../dist/esm/cli-ensure-prepublish-hooks.js');
} catch (error) {
  if (error.code === 'ERR_MODULE_NOT_FOUND') {
    process.stderr.write('ensure-prepublish-hooks: build output not found — run `pnpm run build` first\n');
  } else {
    process.stderr.write(`ensure-prepublish-hooks: failed to load: ${error.message}\n`);
  }
  process.exit(1);
}
