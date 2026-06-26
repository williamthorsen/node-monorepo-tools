/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { buildPackage } from './commands/build.ts';

try {
  await buildPackage(process.cwd());
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
