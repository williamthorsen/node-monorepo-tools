import { existsSync, readFileSync } from 'node:fs';

import { type Git, realGit } from '../git.ts';
import { parseJsonRecord } from './parseJsonRecord.ts';

/** Result of an eligibility check. */
export interface CheckResult {
  ok: boolean;
  message?: string;
}

/** Verifies that the current directory is inside a git repository. */
export function isGitRepo(git: Git = realGit): CheckResult {
  return git.isInsideWorkTree()
    ? { ok: true }
    : { ok: false, message: 'Not inside a git repository. Run `git init` first.' };
}

/** Verifies that package.json exists in the current directory. */
export function hasPackageJson(): CheckResult {
  if (existsSync('package.json')) {
    return { ok: true };
  }
  return {
    ok: false,
    message: 'The current directory does not contain a package.json. Run `npm init` or `pnpm init` first.',
  };
}

/** Verifies that the project uses pnpm, signaled by pnpm-lock.yaml or a pnpm `packageManager` field. */
export function usesPnpm(): CheckResult {
  if (existsSync('pnpm-lock.yaml')) {
    return { ok: true };
  }

  const manifestJson = readFileSync('package.json', 'utf8');
  const packageJson = parseJsonRecord(manifestJson);
  if (
    packageJson !== undefined &&
    typeof packageJson['packageManager'] === 'string' &&
    packageJson['packageManager'].startsWith('pnpm')
  ) {
    return { ok: true };
  }

  return {
    ok: false,
    message: 'This project does not appear to use pnpm. A pnpm-lock.yaml or packageManager field is required.',
  };
}
