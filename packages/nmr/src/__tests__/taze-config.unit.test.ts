import { describe, expect, it } from 'vitest';

import { defineConfig } from '../taze.ts';

describe(defineConfig, () => {
  it("supplies nmr's shared upgrade policy when the repo declares none", () => {
    expect(defineConfig({})).toStrictEqual({ includeLocked: true, maturityPeriod: 7, mode: 'minor' });
  });

  // taze 20.0.1 reports a bare-pinned dependency only when both are set: `includeLocked` alone leaves the
  // range search with no candidate, and `mode` alone is discarded by the locked-dependency guard.
  it('reports a bare-pinned dependency by pairing the locked-dependency setting with a range mode', () => {
    const config = defineConfig({});

    expect(config.includeLocked).toBe(true);
    expect(config.mode).toBe('minor');
  });

  it("passes the repo's own settings through untouched", () => {
    const config = defineConfig({ packageMode: { typescript: 'minor' } });

    expect(config.packageMode).toStrictEqual({ typescript: 'minor' });
  });

  it("lets a repo hold the range mode below nmr's default", () => {
    expect(defineConfig({ mode: 'patch' }).mode).toBe('patch');
  });

  // Clearing the mode hands the search back to taze's `default`, which follows each declared range.
  it('lets a repo clear the range mode with an explicit undefined', () => {
    const config = defineConfig({ mode: undefined });

    expect(config.mode).toBeUndefined();
  });

  it('lets a repo opt out of reporting locked dependencies', () => {
    expect(defineConfig({ includeLocked: false }).includeLocked).toBe(false);
  });

  it("lets a repo raise nmr's default", () => {
    expect(defineConfig({ maturityPeriod: 14 }).maturityPeriod).toBe(14);
  });

  // The classic `||` defaulting bug: 0 is a meaningful value here (no soak at all), not an absent one.
  it('lets a repo disable the soak with 0', () => {
    expect(defineConfig({ maturityPeriod: 0 }).maturityPeriod).toBe(0);
  });

  // taze inherits pnpm's `minimumReleaseAge` only while `maturityPeriod` is nullish, so clearing the
  // default is what hands the policy back to pnpm-workspace.yaml.
  it('lets a repo clear the default with an explicit undefined', () => {
    const config = defineConfig({ maturityPeriod: undefined });

    expect(config.maturityPeriod).toBeUndefined();
  });

  it('does not mutate the shared policy across calls', () => {
    defineConfig({ maturityPeriod: 0 });

    expect(defineConfig({}).maturityPeriod).toBe(7);
  });
});
