/* eslint n/hashbang: off */

import process from 'node:process';

import { describeError } from '@williamthorsen/toolbelt.errors';

import { routeCommand } from './route.ts';

let exitCode: number;
try {
  exitCode = await routeCommand(process.argv.slice(2));
} catch (error: unknown) {
  const message = describeError(error);
  process.stderr.write(`v11y: unexpected error: ${message}\n`);
  exitCode = 1;
}
process.exitCode = exitCode;
