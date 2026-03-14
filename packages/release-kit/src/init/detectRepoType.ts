import { existsSync, readFileSync } from 'node:fs';

import { parseJsonRecord } from './parseJsonRecord.ts';

/** Repo layout type. */
export type RepoType = 'monorepo' | 'single-package';

/**
 * Detect whether the current directory is a monorepo or a single-package repo.
 *
 * Returns `'monorepo'` if `pnpm-workspace.yaml` exists or `package.json` has a `workspaces` field.
 * Otherwise returns `'single-package'`.
 */
export function detectRepoType(): RepoType {
  if (existsSync('pnpm-workspace.yaml')) {
    return 'monorepo';
  }

  try {
    const raw = readFileSync('package.json', 'utf8');
    const pkg = parseJsonRecord(raw);
    if (pkg !== undefined && Array.isArray(pkg.workspaces)) {
      return 'monorepo';
    }
  } catch {
    // Fall through to single-package
  }

  return 'single-package';
}
