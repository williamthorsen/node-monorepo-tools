import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { prependBinDirs } from '../bin-path.ts';

const ROOT = path.resolve('/repo');
const PACKAGE = path.join(ROOT, 'packages/my-pkg');
const ROOT_BIN = path.join(ROOT, 'node_modules/.bin');
const PACKAGE_BIN = path.join(PACKAGE, 'node_modules/.bin');
const SYSTEM_BIN = path.resolve('/usr/bin');

describe(prependBinDirs, () => {
  it('puts the package bin, then the root bin, ahead of the inherited PATH', () => {
    const env = prependBinDirs({ anchorDir: PACKAGE, env: { PATH: SYSTEM_BIN, KEEP: '1' }, monorepoRoot: ROOT });

    expect(env).toStrictEqual({ KEEP: '1', PATH: [PACKAGE_BIN, ROOT_BIN, SYSTEM_BIN].join(path.delimiter) });
  });

  it('adds the root bin once at the root scope', () => {
    const env = prependBinDirs({ anchorDir: ROOT, env: { PATH: SYSTEM_BIN }, monorepoRoot: ROOT });

    expect(env['PATH']).toBe([ROOT_BIN, SYSTEM_BIN].join(path.delimiter));
  });

  it('leaves a directory that PATH already contains where it is', () => {
    const inherited = [SYSTEM_BIN, `${ROOT_BIN}${path.sep}`].join(path.delimiter);

    const env = prependBinDirs({ anchorDir: PACKAGE, env: { PATH: inherited }, monorepoRoot: ROOT });

    expect(env['PATH']).toBe([PACKAGE_BIN, inherited].join(path.delimiter));
  });

  it('keeps PATH unchanged when a nested run applies it again', () => {
    const once = prependBinDirs({ anchorDir: PACKAGE, env: { PATH: SYSTEM_BIN }, monorepoRoot: ROOT });

    const twice = prependBinDirs({ anchorDir: PACKAGE, env: once, monorepoRoot: ROOT });

    expect(twice['PATH']).toBe(once['PATH']);
  });

  it('yields only the bin directories when PATH is unset', () => {
    const env = prependBinDirs({ anchorDir: PACKAGE, env: {}, monorepoRoot: ROOT });

    expect(env['PATH']).toBe([PACKAGE_BIN, ROOT_BIN].join(path.delimiter));
  });

  it('does not mutate the input environment', () => {
    const input = { PATH: SYSTEM_BIN };

    prependBinDirs({ anchorDir: PACKAGE, env: input, monorepoRoot: ROOT });

    expect(input).toStrictEqual({ PATH: SYSTEM_BIN });
  });
});
