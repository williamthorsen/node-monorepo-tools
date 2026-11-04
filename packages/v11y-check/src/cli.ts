/* eslint n/hashbang: off */

import process from 'node:process';

import { reportCrash } from '@williamthorsen/nmr-core';

import { routeCommand } from './route.ts';

let exitCode: number;
try {
  exitCode = await routeCommand(process.argv.slice(2));
} catch (error: unknown) {
  reportCrash('v11y', error);
  exitCode = 1;
}
process.exitCode = exitCode;
