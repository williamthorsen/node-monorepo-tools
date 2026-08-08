#!/usr/bin/env node
try {
  await import('../dist/esm/bin/release-kit.js');
} catch (error) {
  if (error.code === 'ERR_MODULE_NOT_FOUND') {
    process.stderr.write('release-kit: build output not found — run `nmr build` first\n');
  } else {
    process.stderr.write(`release-kit: failed to load: ${error.message}\n`);
  }
  process.exit(1);
}
