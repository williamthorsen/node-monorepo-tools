// Every package's `prepare` runs this file under bare `node`, so this module and everything in its import closure
// must be erasable TypeScript. pnpm can run some `prepare` scripts before nmr-core is built: nmr-core's own, and
// that of any package that does not depend on nmr-core. Each passes `--conditions nmr-source`, which lets the
// compiler import `@williamthorsen/nmr-core` before nmr-core's own `dist` exists.

import { reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { buildPackage } from './commands/build.ts';
import { loadWorkspaceConfig } from './config.ts';
import { resolveBinStyles } from './resolveBinStyles.ts';

try {
  const { stdout } = resolveBinStyles();

  // `nmr-compile` always runs with the package directory as its working directory, which therefore contains the
  // package's own config.
  const packageDir = process.cwd();
  const { build } = await loadWorkspaceConfig(packageDir);

  await buildPackage(packageDir, {
    style: stdout,
    ...(build?.extraIgnorePatterns !== undefined && { extraIgnorePatterns: build.extraIgnorePatterns }),
  });
} catch (error) {
  reportError(describeError(error));
  process.exitCode = 1;
}
