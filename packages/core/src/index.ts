// Placeholder — shared utilities will be added here as the monorepo grows.
export const PACKAGE_NAME = '@williamthorsen/node-monorepo-core';
export type { FlagDefinition, FlagSchema, ParsedArgs, ParsedFlags } from './parseArgs.js';
export { parseArgs } from './parseArgs.js';
export { printError, printSkip, printStep, printSuccess, reportWriteResult } from './terminal.js';
export type { WriteOutcome, WriteResult } from './writeFileWithCheck.js';
export { writeFileWithCheck } from './writeFileWithCheck.js';
