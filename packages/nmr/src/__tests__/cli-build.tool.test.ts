import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

// The bin runs the source directly under Node's type stripping, exactly as `prepare` does.
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

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-cli-build-' })),
);

describe('nmr-compile', () => {
  it('excludes a directory the package config adds to the ignore set', ({ tree }) => {
    scaffoldPackage(
      tree.dir,
      {
        'index.ts': 'export const value = 1;\n',
        'fixtures/sample.ts': 'export const sample = 1;\n',
      },
      `export default { build: { extraIgnorePatterns: ['**/fixtures/**'] } };\n`,
    );

    runCompile(tree.dir);

    expect(listEmitted(tree.dir)).toStrictEqual(['index.d.ts', 'index.js']);
  });

  it('builds on the defaults when the package has no config', ({ tree }) => {
    scaffoldPackage(tree.dir, {
      'index.ts': 'export const value = 1;\n',
      'test-utils/helper.ts': 'export const helper = 1;\n',
    });

    runCompile(tree.dir);

    expect(listEmitted(tree.dir)).toStrictEqual(['index.d.ts', 'index.js']);
  });

  it('fails when the package config declares a key the workspace tier does not honor', ({ tree }) => {
    scaffoldPackage(tree.dir, { 'index.ts': 'export const value = 1;\n' }, `export default { rootScripts: {} };\n`);

    expect(() => runCompile(tree.dir)).toThrow(/not rootScripts/);
    expect(listEmitted(tree.dir)).toStrictEqual([]);
  });

  it('fails when the package config misspells a build key rather than compiling on the defaults', ({ tree }) => {
    scaffoldPackage(
      tree.dir,
      {
        'index.ts': 'export const value = 1;\n',
        'fixtures/sample.ts': 'export const sample = 1;\n',
      },
      `export default { build: { extraIgnorePattern: ['**/fixtures/**'] } };\n`,
    );

    expect(() => runCompile(tree.dir)).toThrow(/unrecognized key `build\.extraIgnorePattern`/);
    expect(listEmitted(tree.dir)).toStrictEqual([]);
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
