import { describe, expect, it } from 'vitest';

import { defineConfig } from '../taze.ts';

describe(defineConfig, () => {
  it("supplies nmr's shared upgrade policy when the repo declares none", () => {
    expect(defineConfig({})).toStrictEqual({ includeLocked: true, mode: 'minor' });
  });

  it("passes the repo's own settings through untouched", () => {
    const config = defineConfig({ packageMode: { typescript: 'minor' } });

    expect(config.packageMode).toStrictEqual({ typescript: 'minor' });
  });

  it('passes per-package maturity periods through alongside the shared policy', () => {
    const config = defineConfig({ packageMaturityPeriod: { '@williamthorsen/*': 1 } });

    expect(config).toStrictEqual({
      includeLocked: true,
      mode: 'minor',
      packageMaturityPeriod: { '@williamthorsen/*': 1 },
    });
  });

  it("lets a repo set the range mode below nmr's default", () => {
    expect(defineConfig({ mode: 'patch' }).mode).toBe('patch');
  });

  it('lets a repo opt out of reporting locked dependencies', () => {
    expect(defineConfig({ includeLocked: false }).includeLocked).toBe(false);
  });

  it('lets a repo set a maturity period', () => {
    expect(defineConfig({ maturityPeriod: 14 }).maturityPeriod).toBe(14);
  });

  // 0 disables the soak, whereas an unset period inherits pnpm's `minimumReleaseAge`.
  it('lets a repo disable the soak with 0', () => {
    expect(defineConfig({ maturityPeriod: 0 }).maturityPeriod).toBe(0);
  });

  // taze defaults `mode` itself, so an `undefined` passed through would overwrite that default rather than defer
  // to it.
  it("hands a cleared range mode back to taze's default", () => {
    expect(defineConfig({ mode: undefined }).mode).toBe('default');
  });

  it('does not mutate the shared policy across calls', () => {
    defineConfig({ mode: 'patch' });

    expect(defineConfig({}).mode).toBe('minor');
  });
});
