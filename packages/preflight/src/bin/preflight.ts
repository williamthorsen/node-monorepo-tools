/* eslint n/hashbang: off, n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import process from 'node:process';

import { routeCommand } from './route.ts';

const exitCode = await routeCommand(process.argv.slice(2));
process.exit(exitCode);
