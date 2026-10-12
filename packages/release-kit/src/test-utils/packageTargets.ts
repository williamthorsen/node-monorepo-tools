import type { PackageTarget } from '../types.ts';

/** Builds the publishable package target of an `@test/{dir}` workspace under `packages/{dir}`, overriding any field. */
export function makeWorkspaceTarget(dir: string, overrides: Partial<PackageTarget> = {}): PackageTarget {
  return {
    id: dir,
    kind: 'package',
    packageName: `@test/${dir}`,
    tagPrefix: `${dir}-v`,
    versionFiles: [`packages/${dir}/package.json`],
    changelogDir: `packages/${dir}`,
    paths: [`packages/${dir}/**`],
    isPublishable: true,
    packagePath: `packages/${dir}`,
    workspaceDir: dir,
    ...overrides,
  };
}
