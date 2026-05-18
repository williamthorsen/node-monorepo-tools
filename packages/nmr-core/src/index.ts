// Placeholder — shared utilities will be added here as the monorepo grows.
export const PACKAGE_NAME = '@williamthorsen/nmr-core';
export { findPackageRoot } from './findPackageRoot.js';
export type { FlagDefinition, FlagSchema, ParsedArgs, ParsedFlags } from './parseArgs.js';
export { parseArgs, translateParseError } from './parseArgs.js';
export { readPackageVersion } from './readPackageVersion.js';
export { printError, printSkip, printStep, printSuccess, reportWriteResult } from './terminal.js';
export type { WriteOutcome, WriteResult } from './writeFileWithCheck.js';
export { writeFileWithCheck } from './writeFileWithCheck.js';
