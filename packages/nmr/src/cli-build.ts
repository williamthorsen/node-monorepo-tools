import { buildPackage } from './commands/build.ts';
import { loadWorkspaceConfig } from './config.ts';

try {
  // `nmr-compile` always runs with the package as its working directory -- from the root recursion, from a
  // package-level invocation, and from either `prepare` script -- so the package's own config is right here.
  const packageDir = process.cwd();
  const { build } = await loadWorkspaceConfig(packageDir);

  await buildPackage(packageDir, {
    ...(build?.extraIgnorePatterns !== undefined && { extraIgnorePatterns: build.extraIgnorePatterns }),
  });
} catch (error) {
  // This file is the build bootstrap: nmr-core's `prepare` runs it (via tsx) to build nmr-core
  // itself, before nmr-core's dist exists. It must not import `@williamthorsen/nmr-core`, so it
  // cannot route through `reportError` and prints the message directly.
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
