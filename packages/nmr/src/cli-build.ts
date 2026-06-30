import { buildPackage } from './commands/build.ts';

try {
  await buildPackage(process.cwd());
} catch (error) {
  // This file is the build bootstrap: nmr-core's `prepare` runs it (via tsx) to build nmr-core
  // itself, before nmr-core's dist exists. It must not import `@williamthorsen/nmr-core`, so it
  // cannot route through `reportError` and prints the message directly.
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
