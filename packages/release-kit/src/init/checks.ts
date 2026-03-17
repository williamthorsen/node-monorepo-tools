import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import { parseJsonRecord } from './parseJsonRecord.ts';

/** Result of an eligibility check. */
export interface CheckResult {
  ok: boolean;
  message?: string;
}

/** Verify the current directory is inside a git repository. */
export function isGitRepo(): CheckResult {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' });
    return { ok: true };
  } catch {
    return { ok: false, message: 'Not inside a git repository. Run `git init` first.' };
  }
}

/** Verify that package.json exists in the current directory. */
export function hasPackageJson(): CheckResult {
  if (existsSync('package.json')) {
    return { ok: true };
  }
  return { ok: false, message: 'No package.json found. Run `npm init` or `pnpm init` first.' };
}

/** Verify that the project uses pnpm (has pnpm-lock.yaml or packageManager field). */
export function usesPnpm(): CheckResult {
  if (existsSync('pnpm-lock.yaml')) {
    return { ok: true };
  }

  const raw = readFileSync('package.json', 'utf8');
  const pkg = parseJsonRecord(raw);
  if (pkg !== undefined && typeof pkg.packageManager === 'string' && pkg.packageManager.startsWith('pnpm')) {
    return { ok: true };
  }

  return {
    ok: false,
    message: 'This project does not appear to use pnpm. A pnpm-lock.yaml or packageManager field is required.',
  };
}
