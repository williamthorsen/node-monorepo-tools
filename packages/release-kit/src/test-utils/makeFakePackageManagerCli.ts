import { vi } from 'vitest';

import type { PackageManagerCli } from '../clients/package-manager/package-manager.ts';

/** A `PackageManagerCli` whose every method is a spy. */
export type FakePackageManagerCli = {
  [Method in keyof PackageManagerCli]: ReturnType<typeof vi.fn<PackageManagerCli[Method]>>;
};

/**
 * Builds a `PackageManagerCli` whose commands succeed, with each method in `overrides` taking the place of the default.
 */
export function makeFakePackageManagerCli(overrides: Partial<PackageManagerCli> = {}): FakePackageManagerCli {
  return {
    publish: vi.fn(overrides.publish ?? (() => {})),
  };
}
