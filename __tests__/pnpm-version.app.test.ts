import assert from 'node:assert';
import fs from 'node:fs';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

import rawPackageJson from '../package.json' with { type: 'json' };
import { GITHUB_ACTION_FILE, GITHUB_ACTION_FILE_PATH } from './config.ts';
import { getValueAtPathOrThrow } from './helpers/getValueAtPathOrThrow.ts';

describe('pnpm version consistency', () => {
  it('pnpm version is the same in GitHub action and package.json', async () => {
    const actionVersion = await getPnpmVersionFromAction();
    const packageJsonVersion = getPnpmVersionFromPackageJson();

    expect(actionVersion).toBe(packageJsonVersion);
  });
});

async function getPnpmVersionFromAction(): Promise<string> {
  const actionYaml = await fs.promises.readFile(GITHUB_ACTION_FILE_PATH, { encoding: 'utf8' });
  const action = yaml.load(actionYaml);
  assert.ok(action, `Action not found in ${GITHUB_ACTION_FILE}`);

  const version = getValueAtPathOrThrow(action, 'jobs.code-quality.with.pnpm-version');

  assert.ok(typeof version === 'string' && version.length > 0, 'pnpm version not found in action');

  return version;
}

/**
 * Extracts the pnpm version from the packageManager field in package.json.
 *
 * @returns The pnpm version string.
 * @throws If the packageManager field is missing, malformed, or not for pnpm.
 */
function getPnpmVersionFromPackageJson(): string {
  const pm = getValueAtPathOrThrow(rawPackageJson, 'packageManager');

  if (typeof pm !== 'string') {
    throw new TypeError('"packageManager" field missing or not a string in package.json.');
  }

  const [name, version] = pm.split('@');
  if (name !== 'pnpm') {
    throw new Error('packageManager is not pnpm.');
  }
  if (!version) {
    throw new Error('pnpm version missing in package.json.');
  }

  return version;
}
