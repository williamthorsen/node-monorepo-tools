import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { describe, expect, it } from 'vitest';

/**
 * Proof that the `@williamthorsen/release-kit/config` entry loads with nothing else on disk, which keeps a config load
 * from importing the rest of the package.
 *
 * The subject is Node's native type stripping, an environment capability that the in-process suite never exercises:
 * Vitest transforms TypeScript through its own pipeline, and `tsc` elides an unused specifier that the stripper
 * retains. So the proof runs the source module -- not `dist`, whose form the compiler has already fixed -- through a
 * real `node`.
 */

const ENTRY_SOURCE_PATH = path.join(import.meta.dirname, '../defineConfig.ts');

/** The erasable type import that the entry uses, and the inline form that silently retains its specifier. */
const ERASABLE_IMPORT = "import type { ReleaseKitConfig } from './types.ts';";
const RETAINING_IMPORT = "import { type ReleaseKitConfig } from './types.ts';";

/** A static import, the form that a config loader issues, so that a retained specifier fails here as it would there. */
const PROBE = ["import { defineConfig } from './defineConfig.ts';", 'process.stdout.write(typeof defineConfig);'].join(
  '\n',
);

describe('the ./config entry under Node type stripping', () => {
  it('loads without any other module on disk', () => {
    const result = loadStandalone(readFileSync(ENTRY_SOURCE_PATH, 'utf8'));

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('function');
  });

  it('fails once a type import is written in the retaining form', () => {
    // Pass a replacer function so that `replace` cannot read any `$` sequence in the replacement as a capture
    // reference.
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

/** Writes `source` alone into a temp directory as the entry module, then imports it from a Node subprocess. */
function loadStandalone(source: string): ProbeResult {
  using tree = createTempTree({}, { prefix: 'release-kit-config-entry-' });
  // Declare ESM rather than lean on Node's syntax detection, so that the module graph is the only thing under test.
  tree.writeJson('package.json', { name: 'config-entry-fixture', type: 'module' });
  tree.write('defineConfig.ts', source);

  const { status, stdout, stderr } = spawnSync(process.execPath, ['--input-type=module', '--eval', PROBE], {
    cwd: tree.dir,
    encoding: 'utf8',
  });

  return { status, stdout, stderr };
}
