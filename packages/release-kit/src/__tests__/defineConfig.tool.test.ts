import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Proof that the `@williamthorsen/release-kit/config` entry loads with nothing else on disk, which is what keeps a
 * config load off the rest of the package.
 *
 * The subject is Node's native type stripping, an environment capability the in-process suite never reaches: Vitest
 * transforms TypeScript through its own pipeline, and `tsc` elides an unused specifier that the stripper retains. So
 * the proof runs the source module -- not `dist`, whose form the compiler has already fixed -- through a real `node`.
 */

const ENTRY_SOURCE_PATH = path.join(import.meta.dirname, '../defineConfig.ts');

/** The erasable type import the entry is written with, and the inline form that silently retains its specifier. */
const ERASABLE_IMPORT = "import type { ReleaseKitConfig } from './types.ts';";
const RETAINING_IMPORT = "import { type ReleaseKitConfig } from './types.ts';";

/** A static import, which is what a config loader issues, so a retained specifier fails here as it would there. */
const PROBE = ["import { defineConfig } from './defineConfig.ts';", 'process.stdout.write(typeof defineConfig);'].join(
  '\n',
);

describe('the ./config entry under Node type stripping', () => {
  it('loads with no other module on disk', () => {
    const result = loadStandalone(readFileSync(ENTRY_SOURCE_PATH, 'utf8'));

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('function');
  });

  it('fails once a type import is written in the retaining form', () => {
    // A replacer function, so no `$` sequence in the replacement could be read as a capture reference.
    const source = readFileSync(ENTRY_SOURCE_PATH, 'utf8').replace(ERASABLE_IMPORT, () => RETAINING_IMPORT);
    // Without this the mutation could silently no-op and re-run the case above, which passes for the wrong reason.
    expect(source).toContain(RETAINING_IMPORT);

    const result = loadStandalone(source);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ERR_MODULE_NOT_FOUND');
  });
});

interface ProbeResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Write `source` alone into a temp directory as the entry module, then import it from a Node subprocess. */
function loadStandalone(source: string): ProbeResult {
  const dir = mkdtempSync(path.join(tmpdir(), 'release-kit-config-entry-'));
  try {
    // Declare ESM rather than lean on Node's syntax detection, so the module graph is the only thing under test.
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'config-entry-fixture', type: 'module' }));
    writeFileSync(path.join(dir, 'defineConfig.ts'), source);

    const { status, stdout, stderr } = spawnSync(process.execPath, ['--input-type=module', '--eval', PROBE], {
      cwd: dir,
      encoding: 'utf8',
    });

    return { status, stdout, stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
