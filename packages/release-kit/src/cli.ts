#!/usr/bin/env node
/* eslint n/hashbang: off */

import process from 'node:process';

import { reportFailure } from '@williamthorsen/nmr-core';

import { BIN } from './bin.ts';
import { routeCommand } from './route.ts';

try {
  process.exitCode = await routeCommand(process.argv.slice(2));
} catch (error: unknown) {
  reportFailure(BIN, error);
  process.exitCode = 1;
}
