import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Proof that the `@williamthorsen/nmr/config` entry loads with nothing else on disk, which is what keeps a config
 * load off the rest of the package.
 *
 * The subject is Node's native type stripping, an environment capability the in-process suite never reaches: Vitest
 * transforms TypeScript through its own pipeline, and `tsc` elides an unused specifier that the stripper retains. So
 * the proof runs the source module -- not `dist`, whose form the compiler has already fixed -- through a real `node`.
 */

const ENTRY_BASENAME = 'defineConfig.ts';
const ENTRY_SOURCE_PATH = path.join(import.meta.dirname, '..', ENTRY_BASENAME);

/** The erasable type import the entry is written with, and the inline form that silently retains its specifier. */
const ERASABLE_IMPORT = "import type { NmrConfig } from './types.ts';";
const RETAINING_IMPORT = "import { type NmrConfig } from './types.ts';";

/** A value import, which no toolchain erases. Stands in for any sibling the entry might one day reach for. */
const VALUE_IMPORT = "import { isObject } from './helpers/type-guards.ts';";

describe('the ./config entry under Node type stripping', () => {
  it('loads with no other module on disk', () => {
    const result = loadStandalone(readFileSync(ENTRY_SOURCE_PATH, 'utf8'));

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('fails once a type import is written in the retaining form', () => {
    const result = loadStandalone(mutateEntry(ERASABLE_IMPORT, RETAINING_IMPORT));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ERR_MODULE_NOT_FOUND');
  });

  it('fails once a value import is added', () => {
    const result = loadStandalone(mutateEntry(ERASABLE_IMPORT, `${VALUE_IMPORT}\n${ERASABLE_IMPORT}`));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ERR_MODULE_NOT_FOUND');
  });
});

// region | Helpers

interface ProbeResult {
  status: number | null;
  stderr: string;
}

/**
 * Rewrites one import of the entry source, failing loudly when the search text no longer matches. A mutation that
 * silently no-ops would re-run the passing case above and report a green result for the wrong reason.
 */
function mutateEntry(search: string, replacement: string): string {
  // A replacer function, so no `$` sequence in the replacement could be read as a capture reference.
  const source = readFileSync(ENTRY_SOURCE_PATH, 'utf8').replace(search, () => replacement);
  if (!source.includes(replacement)) {
    throw new Error(`The entry module no longer contains \`${search}\``);
  }

  return source;
}

/** Writes `source` alone into a temp directory as the entry module, then imports it from a Node subprocess. */
function loadStandalone(source: string): ProbeResult {
  // Nothing else is written, not even a package.json: Node falls back to syntax detection and reads the export as
  // ESM, so a resolution failure can only come from a specifier the entry itself retained.
  const dir = mkdtempSync(path.join(tmpdir(), 'nmr-config-entry-'));
  try {
    const entryPath = path.join(dir, ENTRY_BASENAME);
    writeFileSync(entryPath, source);

    const probe = `await import(${JSON.stringify(pathToFileURL(entryPath).href)});`;
    const { status, stderr } = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
      encoding: 'utf8',
    });

    return { status, stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// endregion | Helpers
