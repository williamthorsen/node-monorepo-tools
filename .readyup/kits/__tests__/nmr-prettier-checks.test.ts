import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { prettierConfigBuildsOnSharedConfig } from '../nmr.ts';

const SHARED_CONFIG =
  "import { definePrettierConfig } from '@williamthorsen/nmr/prettier';\nexport default definePrettierConfig();\n";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs) {
    rmSync(dir, { force: true, recursive: true });
  }
  fixtureDirs.length = 0;
});

describe(prettierConfigBuildsOnSharedConfig, () => {
  // Both spellings are configs Prettier reads, so a check matching only one would report a
  // conformant repo as stale. This repo uses the `.prettierrc.js` form.
  it.each(['.prettierrc.js', '.prettierrc.mjs', '.prettierrc.ts', 'prettier.config.js', 'prettier.config.mts'])(
    'passes when %s builds on the shared config',
    (filename) => {
      const dir = buildRepo({ [filename]: SHARED_CONFIG });

      expect(prettierConfigBuildsOnSharedConfig(dir)).toBe(true);
    },
  );

  it('fails when the config declares its own options instead', () => {
    const dir = buildRepo({ '.prettierrc.js': 'export default { singleQuote: true };\n' });

    expect(detailOf(prettierConfigBuildsOnSharedConfig(dir))).toContain('.prettierrc.js');
  });

  it('fails when the config imports a different export from the shared module', () => {
    const dir = buildRepo({
      'prettier.config.js':
        "import { defineVitestConfig } from '@williamthorsen/nmr/vitest';\nexport default defineVitestConfig();\n",
    });

    expect(detailOf(prettierConfigBuildsOnSharedConfig(dir))).toContain('prettier.config.js');
  });

  it('reports every stale config when both spellings are present', () => {
    const dir = buildRepo({
      '.prettierrc.js': 'export default {};\n',
      'prettier.config.js': 'export default {};\n',
    });

    const detail = detailOf(prettierConfigBuildsOnSharedConfig(dir));
    expect(detail).toContain('.prettierrc.js');
    expect(detail).toContain('prettier.config.js');
  });

  // A data-only config cannot call a factory at all, so skipping it would read as conformant.
  it.each(['.prettierrc', '.prettierrc.json', '.prettierrc.yaml', '.prettierrc.toml'])(
    'fails a repo whose only config is %s',
    (filename) => {
      const dir = buildRepo({ [filename]: '{}\n' });

      expect(detailOf(prettierConfigBuildsOnSharedConfig(dir))).toContain(filename);
    },
  );

  it('fails a repo configuring Prettier through the package.json key', () => {
    const dir = buildRepo({ 'package.json': '{\n  "prettier": { "singleQuote": true }\n}\n' });

    expect(detailOf(prettierConfigBuildsOnSharedConfig(dir))).toContain('package.json');
  });

  it('reports a missing config rather than a data-only one when there is neither', () => {
    const dir = buildRepo({ 'package.json': '{\n  "name": "repo"\n}\n' });

    expect(detailOf(prettierConfigBuildsOnSharedConfig(dir))).toContain('missing');
  });

  it('ignores a config inside a nested node_modules', () => {
    const dir = buildRepo({ 'node_modules/dep/.prettierrc.js': 'export default {};\n' });

    expect(detailOf(prettierConfigBuildsOnSharedConfig(dir))).toContain('missing');
  });
});

function buildRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'nmr-kit-'));
  fixtureDirs.push(dir);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(dir, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, 'utf8');
  }

  return dir;
}

/** Extracts the detail string from a failing check outcome. */
function detailOf(outcome: boolean | { ok: boolean; detail?: string | undefined }): string {
  expect(typeof outcome).toBe('object');
  if (typeof outcome === 'boolean') throw new TypeError('expected a CheckOutcome');
  expect(outcome.ok).toBe(false);
  return outcome.detail ?? '';
}
