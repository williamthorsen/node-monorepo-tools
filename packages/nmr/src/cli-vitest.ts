import process from 'node:process';

import { runNmrVitest } from './commands/run-vitest.ts';

process.exitCode = runNmrVitest(process.argv.slice(2), process.cwd());
