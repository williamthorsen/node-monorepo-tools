import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

const packagesDirectory = resolve(import.meta.dirname, '..', 'packages');
const packagesWithSchemas = readdirSync(packagesDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(packagesDirectory, entry.name, 'schemas')))
  .map((entry) => entry.name)
  .toSorted();

/** Guards that every published JSON Schema ships in its package's tarball, which only `pnpm pack` reports. */
describe('published JSON Schemas in the tarball', () => {
  it('finds a package with schemas to check', () => {
    expect(packagesWithSchemas).not.toStrictEqual([]);
  });

  describe.each(packagesWithSchemas)('%s', (packageName) => {
    const packageDirectory = join(packagesDirectory, packageName);
    let packedPaths: string[];

    beforeAll(() => {
      packedPaths = listPackedPaths(packageDirectory);
    }, 120_000);

    it('contains every schema', () => {
      const schemaPaths = readdirSync(join(packageDirectory, 'schemas'))
        .filter((name) => name.endsWith('.json'))
        .map((name) => `schemas/${name}`);

      expect(schemaPaths).not.toStrictEqual([]);
      expect(packedPaths).toStrictEqual(expect.arrayContaining(schemaPaths));
    });
  });
});

// region | Helpers

/** Narrows `pnpm pack --json` output to the one field that this test reads. */
function isPackReport(value: unknown): value is { files: Array<{ path: string }> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'files' in value &&
    Array.isArray(value.files) &&
    value.files.every((file: unknown) => typeof file === 'object' && file !== null && 'path' in file)
  );
}

/**
 * Returns the package-root-relative paths that `pnpm pack` would publish. Scripts are skipped so that `prepare` does
 * not compile the package: Nothing asserted here reads `dist`. `pnpm pack` rejects a bare `--ignore-scripts`, hence
 * the `--config` form.
 */
function listPackedPaths(packageDirectory: string): string[] {
  const stdout = execFileSync('pnpm', ['pack', '--dry-run', '--json', '--config.ignore-scripts=true'], {
    cwd: packageDirectory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  const parsedReport: unknown = JSON.parse(stdout);
  if (!isPackReport(parsedReport)) {
    throw new Error(`pnpm pack --json did not return a file list: ${stdout}`);
  }
  return parsedReport.files.map((file) => file.path);
}

// endregion | Helpers
