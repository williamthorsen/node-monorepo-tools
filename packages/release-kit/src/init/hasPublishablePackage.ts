import { readFileSync } from 'node:fs';
import path from 'node:path';

import { discoverWorkspaces } from '../discoverWorkspaces.ts';
import { isPublishableManifest } from '../isPublishableManifest.ts';

/**
 * Reports whether the repo at `root` contains a package that can be published: a discovered workspace, or the root
 * package of a single-package repo, whose `package.json` is not private.
 *
 * Returns `true` whenever the answer cannot be determined (an empty workspace, a failed discovery, or an unreadable
 * manifest), so that the scaffolding commands keep the publish workflows in every repo that might need them.
 */
export function hasPublishablePackage(root: string = process.cwd()): boolean {
  let packageDirs: string[];
  try {
    const workspace = discoverWorkspaces(root);
    if (workspace.kind === 'empty') return true;
    packageDirs = workspace.kind === 'single-package' ? ['.'] : workspace.packageDirs;
  } catch {
    return true;
  }

  return packageDirs.some((packageDir) => isPublishableAt(path.join(root, packageDir, 'package.json')));
}

/** Formats the line that reports a workflow skipped because the repo does not contain any publishable package. */
export function formatPrivateWorkflowSkip(filePath: string): string {
  return `Skipping ${filePath}: every package is private`;
}

// region | Helpers
/** Reports whether the manifest at `manifestPath` is publishable, treating an unreadable one as publishable. */
function isPublishableAt(manifestPath: string): boolean {
  try {
    return isPublishableManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  } catch {
    return true;
  }
}
// endregion | Helpers
