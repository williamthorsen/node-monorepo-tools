// Every package's `prepare` runs this file under bare `node`, so this module and everything it reaches must be
// erasable TypeScript. A `prepare` that pnpm can run before nmr-core is built, nmr-core's own or one in a package
// that does not depend on nmr-core, passes `--conditions nmr-source`, which is what lets the compiler import
// `@williamthorsen/nmr-core` before nmr-core's own `dist` exists.

import { reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { buildPackage } from './commands/build.ts';
import { loadWorkspaceConfig } from './config.ts';
import { resolveBinStyles } from './resolveBinStyles.ts';

try {
  const { stdout } = resolveBinStyles();

  // `nmr-compile` always runs with the package as its working directory -- from the root recursion, from a
  // package-level invocation, and from either `prepare` script -- so the package's own config is right here.
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
