import { vi } from 'vitest';

import type { Gh } from '../clients/gh/gh.ts';

/** A `Gh` whose every method is a spy. */
export type FakeGh = { [Method in keyof Gh]: ReturnType<typeof vi.fn<Gh[Method]>> };

/** Builds a `Gh` that is available and whose commands succeed, with each method in `overrides` taking the place of the default. */
export function makeFakeGh(overrides: Partial<Gh> = {}): FakeGh {
  return {
    createRelease: vi.fn(overrides.createRelease ?? (() => {})),
    isAvailable: vi.fn(overrides.isAvailable ?? (() => true)),
    runWorkflow: vi.fn(overrides.runWorkflow ?? (() => {})),
  };
}
