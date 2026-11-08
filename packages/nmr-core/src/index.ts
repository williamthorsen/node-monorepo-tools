export const PACKAGE_NAME = '@williamthorsen/nmr-core';
export type { CacheDirRef, CacheEntryRef } from './cache/cache-store.ts';
export {
  readCacheEntry,
  readGuardedCacheEntry,
  readJsonCacheEntry,
  removeCacheDir,
  removeCacheEntry,
  resolveCacheDir,
  resolveCacheEntryPath,
  writeCacheEntry,
  writeGuardedCacheEntry,
} from './cache/cache-store.ts';
export { hasErrnoCode } from './errors/hasErrnoCode.ts';
export { isAnticipatedFailure } from './errors/isAnticipatedFailure.ts';
export { UserError } from './errors/UserError.ts';
export type { ManagedFileOutcome, ManagedFileResult } from './files/updateManagedFile.ts';
export { updateManagedFile } from './files/updateManagedFile.ts';
export type { WriteOutcome, WriteResult } from './files/writeFileWithCheck.ts';
export { writeFileWithCheck } from './files/writeFileWithCheck.ts';
export { GIT_OUTPUT_LIMIT_BYTES } from './git/gitOutputLimit.ts';
export type { WorkingTreeHashResult } from './git/hashWorkingTree.ts';
export { hashWorkingTree, readHeadSha } from './git/hashWorkingTree.ts';
export type { GitResult } from './git/runGit.ts';
export { runGit } from './git/runGit.ts';
export { isRecord } from './portable/isRecord.ts';
export type {
  GlyphSet,
  InvalidOutputStyle,
  OutputStyle,
  ResolveStreamStylesOptions,
  StatusGlyphName,
  StreamStyleResolution,
  StreamStyles,
  TruncateToWidthOptions,
} from './terminal.ts';
export {
  defineGlyphSet,
  describeInvalidOutputStyle,
  formatErrorLine,
  formatGlyphLine,
  formatStatusLine,
  measureGlyphColumn,
  measureWidth,
  printError,
  printSkip,
  printStep,
  printSuccess,
  reportCrash,
  reportError,
  reportFailure,
  reportTemplateUpdate,
  reportWriteResult,
  resolveStreamStyles,
  STATUS_GLYPHS,
  truncateToWidth,
  wrapToWidth,
} from './terminal.ts';
export { startTimer } from './timer.ts';
export { findPackageRoot, resolveSelfVersion } from '@williamthorsen/toolbelt.packaging/candidate';
