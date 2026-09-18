import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { OUTPUT_STYLE_ENV_VAR } from '../output-style.ts';

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
      tree,
      {
        'index.ts': 'export const value = 1;\n',
        'fixtures/sample.ts': 'export const sample = 1;\n',
      },
      `export default { build: { extraIgnorePatterns: ['**/fixtures/**'] } };\n`,
    );

    runCompile(tree.dir);

    expect(listEmitted(tree)).toStrictEqual(['index.d.ts', 'index.js']);
  });

  it('builds on the defaults when the package has no config', ({ tree }) => {
    scaffoldPackage(tree, {
      'index.ts': 'export const value = 1;\n',
      'test-utils/helper.ts': 'export const helper = 1;\n',
    });

    runCompile(tree.dir);

    expect(listEmitted(tree)).toStrictEqual(['index.d.ts', 'index.js']);
  });

  it('fails when the package config declares a key the workspace tier does not honor', ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' }, `export default { rootScripts: {} };\n`);

    expect(() => runCompile(tree.dir)).toThrow(/not rootScripts/);
    expect(listEmitted(tree)).toStrictEqual([]);
  });

  it('fails when the package config misspells a build key rather than compiling on the defaults', ({ tree }) => {
    scaffoldPackage(
      tree,
      {
        'index.ts': 'export const value = 1;\n',
        'fixtures/sample.ts': 'export const sample = 1;\n',
      },
      `export default { build: { extraIgnorePattern: ['**/fixtures/**'] } };\n`,
    );

    expect(() => runCompile(tree.dir)).toThrow(/unrecognized key `build\.extraIgnorePattern`/);
    expect(listEmitted(tree)).toStrictEqual([]);
  });

  // The bin carries no flag of its own; what reaches it is the variable `nmr <command>` exports to it.
  it.for([
    { marker: '', style: 'plain' },
    { marker: '📦 ', style: 'rich' },
  ])('reports its build in the $style the variable names', ({ marker, style }, { tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });

    const lines = runCompile(tree.dir, { [OUTPUT_STYLE_ENV_VAR]: style }).split('\n');

    expect(lines).toContain(`${marker}${path.basename(tree.dir)}: Changes detected.`);
  });

  it('exits 1 on a variable that names no style, in the words every nmr package rejects one with', ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });

    const { status, stderr } = spawnSync(process.execPath, [CLI_PATH], {
      cwd: tree.dir,
      encoding: 'utf8',
      env: { ...process.env, [OUTPUT_STYLE_ENV_VAR]: 'fancy' },
    });

    expect(status).toBe(1);
    expect(stderr).toContain(`${OUTPUT_STYLE_ENV_VAR} must be one of: auto, plain, rich (got "fancy")`);
    expect(listEmitted(tree)).toStrictEqual([]);
  });
});

// region | Helpers

/** Lists the files the build emitted, relative to the output directory. */
function listEmitted(tree: TempTree): string[] {
  return tree.listFiles('dist/esm');
}

/** Writes a package tree, plus a `.config/nmr.config.ts` when `config` is given. */
function scaffoldPackage(tree: TempTree, sources: Record<string, string>, config?: string): void {
  tree.writeJson('package.json', { name: 'fixture', type: 'module' });
  tree.writeJson('tsconfig.json', TSCONFIG);
  tree.mkdir('node_modules');
  tree.writeAll(Object.fromEntries(Object.entries(sources).map(([name, contents]) => [`src/${name}`, contents])));

  if (config !== undefined) {
    tree.write('.config/nmr.config.ts', config);
  }
}

/** Runs the bin against `dir`, returning what it wrote to stdout. */
function runCompile(dir: string, env: NodeJS.ProcessEnv = {}): string {
  return execFileSync(process.execPath, [CLI_PATH], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
}

// endregion | Helpers
