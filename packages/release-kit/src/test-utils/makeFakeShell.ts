import { vi } from 'vitest';

import type { Shell } from '../clients/shell/shell.ts';

/** A `Shell` whose every method is a spy. */
export type FakeShell = { [Method in keyof Shell]: ReturnType<typeof vi.fn<Shell[Method]>> };

/** Builds a `Shell` whose commands succeed, with each method in `overrides` taking the place of the default. */
export function makeFakeShell(overrides: Partial<Shell> = {}): FakeShell {
  return {
    run: vi.fn(overrides.run ?? (() => {})),
  };
}
