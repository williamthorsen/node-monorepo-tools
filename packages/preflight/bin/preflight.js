#!/usr/bin/env node
import('../dist/esm/bin/preflight.js').catch((err) => {
  process.stderr.write(`preflight: failed to load: ${err.message}\n`);
  process.exit(1);
});
