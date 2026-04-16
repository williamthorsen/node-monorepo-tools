#!/usr/bin/env node
try {
  await import('../dist/esm/bin/audit-deps.js');
} catch (error) {
  if (error.code === 'ERR_MODULE_NOT_FOUND') {
    process.stderr.write('audit-deps: build output not found — run `pnpm run build` first\n');
  } else {
    process.stderr.write(`audit-deps: failed to load: ${error.message}\n`);
  }
  process.exit(1);
}
