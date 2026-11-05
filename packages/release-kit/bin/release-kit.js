#!/usr/bin/env node
try {
  await import('../dist/esm/cli.js');
} catch (error) {
  if (error?.code === 'ERR_MODULE_NOT_FOUND') {
    process.stderr.write('release-kit: build output not found; run `nmr build` first\n');
  } else {
    const message = error instanceof Error && error.message !== '' ? error.message : String(error);
    const lines = error instanceof Error && typeof error.stack === 'string' ? error.stack.split('\n') : [];
    const firstFrame = lines.findIndex((line) => /^\s+at /.test(line));
    const frames = firstFrame === -1 ? '' : `${lines.slice(firstFrame).join('\n')}\n`;
    process.stderr.write(`release-kit: internal error: ${message}\n${frames}`);
  }
  process.exit(1);
}
