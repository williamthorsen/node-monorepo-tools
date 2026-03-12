import assert from 'node:assert';
import fs from 'node:fs';

import { ASDF_VERSION_FILE } from '../config.ts';

/**
 * Reads the .tool-versions file and returns the version for the specified runtime.
 *
 * @param runtime - The runtime name as it appears at the start of a line in .tool-versions (e.g., "nodejs", "pnpm").
 * @returns The version string for the specified runtime.
 * @throws If the runtime is not found or the version is missing.
 */
export async function getRuntimeVersionFromAsdf(runtime: string): Promise<string> {
  const toolVersions = await fs.promises.readFile(ASDF_VERSION_FILE, { encoding: 'utf8' });

  const versionLine = toolVersions.split('\n').find((line) => line.trim().startsWith(runtime));

  assert.ok(versionLine, `${runtime} not found in .tool-versions`);

  const [, version] = versionLine.trim().split(/\s+/);
  assert.ok(version, `${runtime} version missing in .tool-versions`);

  return version;
}
