import { captureStdio, createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { runCompile } from '../compile.ts';

const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-compile-' })),
);

describe(runCompile, () => {
  it.for(['--help', '-h'])('answers %s with help and compiles nothing', async (flag, { tree }) => {
    scaffoldCompilablePackage(tree);
    using captured = captureStdio();

    await expect(runCompile([flag], tree.dir)).resolves.toBe(0);

    expect(captured.stdout).toContain('Usage: nmr-compile');
    expect(tree.exists('dist')).toBe(false);
  });

  it.for(['--bogus', 'src'])('rejects %s as a usage error and compiles nothing', async (argument, { tree }) => {
    scaffoldCompilablePackage(tree);
    using captured = captureStdio();

    await expect(runCompile([argument], tree.dir)).resolves.toBe(2);

    expect(captured.stderr).toContain("Try 'nmr-compile --help'.");
    expect(tree.exists('dist')).toBe(false);
  });
});

// region | Helpers

/** Writes a compilable package, so that a run which reached the build would emit `dist`. */
function scaffoldCompilablePackage(tree: TempTree): void {
  tree.writeAll({
    'package.json': JSON.stringify({ name: 'fixture', type: 'module' }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'NodeNext', strict: true }, include: ['src/'] }),
    'src/index.ts': 'export const value = 1;\n',
  });
}

// endregion | Helpers
