#!/usr/bin/env node
/* eslint n/hashbang: off */

import process from 'node:process';

import { reportFailure } from '@williamthorsen/nmr-core';

import { runCli } from './runCli.ts';

try {
  await runCli(process.argv.slice(2));
} catch (error: unknown) {
  reportFailure('release-kit', error);
  process.exitCode = 1;
}
