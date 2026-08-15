import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Every fixture directory built so far, so one teardown clears all of them. */
const fixtureDirs: string[] = [];

/**
 * Builds a fixture repo in a temp directory from a map of repo-relative paths to file contents, returning its
 * directory. Parent directories are created as needed, so a map may name a nested path directly.
 *
 * Temp directories rather than committed fixtures: a fixture carries the very shape the check under test looks
 * for, so committing one turns this repo into a target of its own checks. A `*.integration.test.ts` under any
 * `__tests__/` would be collected by the `unit` project, and a `package.json` declaring a `pnpm` field would be
 * reported by the check that rejects one.
 */
export function buildRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'nmr-kit-'));
  fixtureDirs.push(dir);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(dir, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, 'utf8');
  }

  return dir;
}

/** Removes every fixture directory built so far. */
export function removeFixtureDirs(): void {
  for (const dir of fixtureDirs) {
    rmSync(dir, { force: true, recursive: true });
  }
  fixtureDirs.length = 0;
}
