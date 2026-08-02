import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The bin runs the source directly under Node's type stripping, exactly as `prepare` does through tsx.
// Driving it as a process is what covers the wiring the unit tests cannot: that `nmr-compile` reads the
// config of whichever package it is invoked in.
const CLI_PATH = path.join(import.meta.dirname, '..', 'cli-build.ts');

const TSCONFIG = {
  compilerOptions: {
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    target: 'ES2022',
    allowImportingTsExtensions: true,
    declaration: true,
    strict: true,
  },
  include: ['src/'],
};

describe('nmr-compile', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-cli-build-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('excludes a directory the package config adds to the ignore set', () => {
    scaffoldPackage(
      dir,
      {
        'index.ts': 'export const value = 1;\n',
        'fixtures/sample.ts': 'export const sample = 1;\n',
      },
      `export default { build: { extraIgnorePatterns: ['**/fixtures/**'] } };\n`,
    );

    runCompile(dir);

    expect(listEmitted(dir)).toStrictEqual(['index.d.ts', 'index.js']);
  });

  it('builds on the defaults when the package has no config', () => {
    scaffoldPackage(dir, {
      'index.ts': 'export const value = 1;\n',
      'test-utils/helper.ts': 'export const helper = 1;\n',
    });

    runCompile(dir);

    expect(listEmitted(dir)).toStrictEqual(['index.d.ts', 'index.js']);
  });

  it('fails when the package config declares a key the workspace tier does not honor', () => {
    scaffoldPackage(dir, { 'index.ts': 'export const value = 1;\n' }, `export default { rootScripts: {} };\n`);

    expect(() => runCompile(dir)).toThrow(/not rootScripts/);
    expect(listEmitted(dir)).toStrictEqual([]);
  });
});

// region | Helpers

function listEmitted(dir: string): string[] {
  const outdir = path.join(dir, 'dist', 'esm');
  if (!fs.existsSync(outdir)) {
    return [];
  }

  return fs
    .readdirSync(outdir, { recursive: true })
    .map(String)
    .filter((entry) => fs.statSync(path.join(outdir, entry)).isFile())
    .map((entry) => entry.split(path.sep).join('/'))
    .toSorted();
}

/** Writes a package tree, plus a `.config/nmr.config.ts` when `config` is given. */
function scaffoldPackage(dir: string, sources: Record<string, string>, config?: string): void {
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }));
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(TSCONFIG));

  for (const [relativePath, contents] of Object.entries(sources)) {
    const filePath = path.join(dir, 'src', relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }

  if (config !== undefined) {
    fs.mkdirSync(path.join(dir, '.config'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.config', 'nmr.config.ts'), config);
  }
}

function runCompile(dir: string): string {
  return execFileSync(process.execPath, [CLI_PATH], { cwd: dir, encoding: 'utf8' });
}

// endregion | Helpers
