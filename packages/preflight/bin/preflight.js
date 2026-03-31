#!/usr/bin/env node
try {
  await import('../dist/esm/bin/preflight.js');
} catch (error) {
  process.stderr.write(`preflight: failed to load: ${error.message}\n`);
  process.exit(1);
}
