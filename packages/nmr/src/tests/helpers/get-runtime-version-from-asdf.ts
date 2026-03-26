import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Reads the .tool-versions file from the monorepo root and returns
 * the version for the specified runtime.
 *
 * @param runtime - The runtime name as it appears at the start of a line
 *   in .tool-versions (e.g., "nodejs", "pnpm").
 * @param monorepoRoot - Path to the monorepo root.
 * @throws If the runtime is not found or the version is missing.
 */
export async function getRuntimeVersionFromAsdf(runtime: string, monorepoRoot: string): Promise<string> {
  const toolVersionsPath = path.join(monorepoRoot, '.tool-versions');
  const toolVersions = await fs.promises.readFile(toolVersionsPath, { encoding: 'utf8' });

  const versionLine = toolVersions.split('\n').find((line) => line.trim().startsWith(runtime));

  assert.ok(versionLine, `${runtime} not found in .tool-versions`);

  const [, version] = versionLine.trim().split(/\s+/);
  assert.ok(version, `${runtime} version missing in .tool-versions`);

  return version;
}
