import { vi } from 'vitest';

import type { Npm } from '../clients/npm/npm-registry.ts';

/** An `Npm` whose every method is a spy. */
export type FakeNpm = { [Method in keyof Npm]: ReturnType<typeof vi.fn<Npm[Method]>> };

/** Builds an `Npm` whose registry lists every package, with each method in `overrides` taking the place of the default. */
export function makeFakeNpm(overrides: Partial<Npm> = {}): FakeNpm {
  return {
    viewVersion: vi.fn(overrides.viewVersion ?? (() => ({ ok: true }))),
  };
}
