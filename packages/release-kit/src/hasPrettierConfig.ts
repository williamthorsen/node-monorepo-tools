import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { isRecord } from './typeGuards.ts';

/**
 * Detects whether the repo has a Prettier configuration.
 *
 * Checks for config files in the working directory and for a `"prettier"` key
 * in the root `package.json`. Returns `true` if any indicator is found.
 */
export function hasPrettierConfig(): boolean {
  const cwd = process.cwd();

  for (const file of PRETTIER_CONFIG_FILES) {
    if (existsSync(path.join(cwd, file))) {
      return true;
    }
  }

  return hasPrettierKeyInPackageJson(path.join(cwd, 'package.json'));
}

/** Returns true if `package.json` contains a top-level `"prettier"` key. */
function hasPrettierKeyInPackageJson(packageJsonPath: string): boolean {
  if (!existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return isRecord(parsed) && 'prettier' in parsed;
  } catch {
    return false;
  }
}

/** Config file names that indicate a project uses prettier. */
const PRETTIER_CONFIG_FILES = [
  '.prettierrc',
  '.prettierrc.cjs',
  '.prettierrc.js',
  '.prettierrc.json',
  '.prettierrc.json5',
  '.prettierrc.mjs',
  '.prettierrc.toml',
  '.prettierrc.ts',
  '.prettierrc.yaml',
  '.prettierrc.yml',
  'prettier.config.cjs',
  'prettier.config.js',
  'prettier.config.mjs',
  'prettier.config.ts',
];
