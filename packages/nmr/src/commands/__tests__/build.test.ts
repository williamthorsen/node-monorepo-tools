import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeBuildHash, resolveTsconfigChain } from '../build.ts';

describe(computeBuildHash, () => {
  const COMPILER_VERSION = '5.9.3';

  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-build-hash-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns the same digest regardless of entry-point order', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;');
    fs.writeFileSync(path.join(dir, 'b.ts'), 'export const b = 2;');

    const forward = await computeBuildHash(dir, ['a.ts', 'b.ts'], { outdir: 'dist/esm/' }, COMPILER_VERSION);
    const reversed = await computeBuildHash(dir, ['b.ts', 'a.ts'], { outdir: 'dist/esm/' }, COMPILER_VERSION);

    expect(reversed).toBe(forward);
  });

  it('changes the digest when a file path changes but its content does not', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const x = 1;');
    fs.writeFileSync(path.join(dir, 'b.ts'), 'export const x = 1;');

    const asA = await computeBuildHash(dir, ['a.ts'], { outdir: 'dist/esm/' }, COMPILER_VERSION);
    const asB = await computeBuildHash(dir, ['b.ts'], { outdir: 'dist/esm/' }, COMPILER_VERSION);

    expect(asB).not.toBe(asA);
  });

  it('changes the digest when file content changes', async () => {
    const file = path.join(dir, 'a.ts');
    fs.writeFileSync(file, 'export const x = 1;');
    const before = await computeBuildHash(dir, ['a.ts'], { outdir: 'dist/esm/' }, COMPILER_VERSION);

    fs.writeFileSync(file, 'export const x = 2;');
    const after = await computeBuildHash(dir, ['a.ts'], { outdir: 'dist/esm/' }, COMPILER_VERSION);

    expect(after).not.toBe(before);
  });

  it('changes the digest when emit config changes', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const x = 1;');

    const esm = await computeBuildHash(dir, ['a.ts'], { outdir: 'dist/esm/' }, COMPILER_VERSION);
    const other = await computeBuildHash(dir, ['a.ts'], { outdir: 'dist/cjs/' }, COMPILER_VERSION);

    expect(other).not.toBe(esm);
  });

  it('changes the digest when the compiler version changes', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const x = 1;');

    const under59 = await computeBuildHash(dir, ['a.ts'], { outdir: 'dist/esm/' }, '5.9.3');
    const under60 = await computeBuildHash(dir, ['a.ts'], { outdir: 'dist/esm/' }, '6.0.3');

    expect(under60).not.toBe(under59);
  });

  it('changes the digest when an extended base config in the chain changes', async () => {
    const packageDir = path.join(dir, 'pkg');
    fs.mkdirSync(packageDir);
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }));
    fs.writeFileSync(path.join(dir, 'base.json'), JSON.stringify({ compilerOptions: { target: 'ES2022' } }));
    fs.writeFileSync(path.join(packageDir, 'tsconfig.json'), JSON.stringify({ extends: '../base.json' }));

    // The base config is reachable only through `extends`; the leaf tsconfig stays byte-identical.
    const files = ['package.json', ...resolveTsconfigChain(packageDir)];
    const before = await computeBuildHash(packageDir, files, { outdir: 'dist/esm/' }, COMPILER_VERSION);

    fs.writeFileSync(path.join(dir, 'base.json'), JSON.stringify({ compilerOptions: { target: 'ES2021' } }));
    const after = await computeBuildHash(packageDir, files, { outdir: 'dist/esm/' }, COMPILER_VERSION);

    expect(after).not.toBe(before);
  });
});

describe(resolveTsconfigChain, () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-tsconfig-chain-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns only the leaf tsconfig when it extends nothing', () => {
    const packageDir = path.join(dir, 'pkg');
    fs.mkdirSync(packageDir);
    fs.writeFileSync(path.join(packageDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }));

    expect(resolveTsconfigChain(packageDir)).toEqual(['tsconfig.json']);
  });

  it('includes the leaf and each transitively extended base config, relative to the package', () => {
    const packageDir = path.join(dir, 'packages', 'pkg');
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tsconfig.base.json'), JSON.stringify({ compilerOptions: { strict: true } }));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ extends: './tsconfig.base.json' }));
    fs.writeFileSync(path.join(packageDir, 'tsconfig.json'), JSON.stringify({ extends: '../../tsconfig.json' }));

    expect(resolveTsconfigChain(packageDir)).toEqual([
      'tsconfig.json',
      '../../tsconfig.json',
      '../../tsconfig.base.json',
    ]);
  });
});
