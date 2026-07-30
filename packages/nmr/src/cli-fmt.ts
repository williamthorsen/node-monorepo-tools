import process from 'node:process';

import { runFmt } from './commands/fmt.ts';

process.exitCode = runFmt(process.argv.slice(2), process.cwd());
