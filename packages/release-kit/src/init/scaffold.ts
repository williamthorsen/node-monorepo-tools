import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { findPackageRoot } from '../findPackageRoot.ts';
import type { RepoType } from './detectRepoType.ts';
import { printError, printSkip, printSuccess } from './prompt.ts';
import { releaseConfigScript, releaseWorkflow } from './templates.ts';

interface ScaffoldOptions {
  repoType: RepoType;
  dryRun: boolean;
  overwrite: boolean;
  withConfig: boolean;
}

/** Attempt to write a file, printing a user-friendly error on failure. Returns true on success. */
function tryWriteFile(filePath: string, content: string): boolean {
  try {
    writeFileSync(filePath, content, 'utf8');
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    printError(`Failed to write ${filePath}: ${message}`);
    return false;
  }
}

/** Write a file, creating parent directories as needed. Skips if the file already exists and overwrite is false. */
function writeIfAbsent(filePath: string, content: string, dryRun: boolean, overwrite: boolean): void {
  if (existsSync(filePath) && !overwrite) {
    printSkip(`${filePath} (already exists)`);
    return;
  }

  if (dryRun) {
    printSuccess(`[dry-run] Would create ${filePath}`);
    return;
  }

  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    printError(`Failed to create directory for ${filePath}: ${message}`);
    return;
  }

  if (tryWriteFile(filePath, content)) {
    printSuccess(`Created ${filePath}`);
  }
}

/** Copy the bundled cliff.toml.template to `.config/git-cliff.toml` in the target repo. */
export function copyCliffTemplate(dryRun: boolean, overwrite: boolean): void {
  const root = findPackageRoot(import.meta.url);
  const templatePath = resolve(root, 'cliff.toml.template');

  if (!existsSync(templatePath)) {
    printError(`Could not find cliff.toml.template at ${templatePath}`);
    return;
  }

  let content: string;
  try {
    content = readFileSync(templatePath, 'utf8');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    printError(`Failed to read cliff.toml.template: ${message}`);
    return;
  }
  writeIfAbsent('.config/git-cliff.toml', content, dryRun, overwrite);
}

/** Scaffold release-kit files for the target repo. */
export function scaffoldFiles({ repoType, dryRun, overwrite, withConfig }: ScaffoldOptions): void {
  writeIfAbsent('.github/workflows/release.yaml', releaseWorkflow(repoType), dryRun, overwrite);

  if (withConfig) {
    writeIfAbsent('.config/release-kit.config.ts', releaseConfigScript(repoType), dryRun, overwrite);
    copyCliffTemplate(dryRun, overwrite);
  }
}
