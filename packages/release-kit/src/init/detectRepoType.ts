import { existsSync, readFileSync } from 'node:fs';

import { parseJsonRecord } from './parseJsonRecord.ts';

/** Repo layout type. */
export type RepoType = 'monorepo' | 'single-package';

/**
 * Detects whether the current directory is a monorepo or a single-package repo.
 *
 * A monorepo has `pnpm-workspace.yaml` or a `workspaces` array in `package.json`.
 */
export function detectRepoType(): RepoType {
  if (existsSync('pnpm-workspace.yaml')) {
    return 'monorepo';
  }

  if (existsSync('package.json')) {
    const manifestJson = readFileSync('package.json', 'utf8');
    const packageJson = parseJsonRecord(manifestJson);
    if (packageJson !== undefined && Array.isArray(packageJson['workspaces'])) {
      return 'monorepo';
    }
  }

  return 'single-package';
}
