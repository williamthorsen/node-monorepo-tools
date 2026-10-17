import type { TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import * as ts from 'typescript';
import { vi } from 'vitest';

const TSCONFIG = {
  compilerOptions: {
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    target: 'ES2022',
    allowImportingTsExtensions: true,
    declaration: true,
    strict: true,
    baseUrl: '.',
    paths: { '~/*': ['./src/*'] },
  },
  include: ['src/'],
};

/** Reads the programs returned by the mocked compiler, in the order the build created them. */
export function collectPrograms(): ts.Program[] {
  const programs: ts.Program[] = [];
  for (const result of vi.mocked(ts.createProgram).mock.results) {
    if (isProgram(result.value)) {
      programs.push(result.value);
    }
  }
  return programs;
}

/**
 * Counts the builds that called the compiler. A build creates two programs, the scripts program and the
 * declarations program over it, and only the first is created without an `oldProgram`.
 */
export function countBuilds(): number {
  return vi.mocked(ts.createProgram).mock.calls.filter((call) => call[3] === undefined).length;
}

/** Lists every file under the package's emit directory, relative to it. */
export function listEmitted(tree: TempTree): string[] {
  return tree.listFiles('dist/esm');
}

/** Reads an emitted file from the package's emit directory. */
export function readOutput(tree: TempTree, relativePath: string): string {
  return tree.read(`dist/esm/${relativePath}`);
}

/** Writes a self-contained package tree (package.json, tsconfig.json, and the given `src` files). */
export function scaffoldPackage(
  tree: TempTree,
  sources: Record<string, string>,
  extraCompilerOptions: Record<string, unknown> = {},
): void {
  const tsconfig = {
    ...TSCONFIG,
    compilerOptions: { ...TSCONFIG.compilerOptions, ...extraCompilerOptions },
  };
  tree.writeAll({
    // Give the fixture its own node_modules so that the build cache resolves inside the temp dir
    // (hermetic, cleaned up with it) rather than to some ancestor node_modules above the OS temp root.
    'node_modules/': '',
    'package.json': JSON.stringify({ name: 'fixture', type: 'module' }),
    'tsconfig.json': JSON.stringify(tsconfig),
    ...Object.fromEntries(Object.entries(sources).map(([entry, contents]) => [`src/${entry}`, contents])),
  });
}

// region | Helpers

/** Reports whether a mock result is a TypeScript program. */
function isProgram(value: unknown): value is ts.Program {
  return typeof value === 'object' && value !== null && 'getSourceFile' in value;
}

// endregion | Helpers
