import { afterEach, describe, expect, it } from 'vitest';

import { noPnpmFieldInPackageJson } from '../../.readyup/kits/default.ts';
import { buildRepo, removeFixtureDirs } from '../test-utils/fixture-repo.ts';
import { getDetail } from '../test-utils/getDetail.ts';

const WORKSPACE_YAML = "packages:\n  - packages/*\n\noverrides:\n  tar: '>=6.2.1'\n";

describe(noPnpmFieldInPackageJson, () => {
  afterEach(removeFixtureDirs);

  it('passes when the overrides live in pnpm-workspace.yaml alone', () => {
    const dir = buildRepo({
      'package.json': '{ "name": "root" }\n',
      'packages/api/package.json': '{ "name": "api" }\n',
      'pnpm-workspace.yaml': WORKSPACE_YAML,
    });

    expect(noPnpmFieldInPackageJson(dir)).toBe(true);
  });

  // The fixture writes its keys out of order deliberately: the assertion names them sorted, so it pins the sort
  // rather than the manifest's own order. Two repos declaring the same keys would otherwise render differently.
  it('reports the root and workspace manifests together, each with the keys it holds', () => {
    const dir = buildRepo({
      'package.json': '{ "pnpm": { "patchedDependencies": {}, "overrides": { "tar": ">=6.2.1" } } }\n',
      'packages/api/package.json': '{ "pnpm": { "overrides": { "semver": ">=7.5.2" } } }\n',
      'pnpm-workspace.yaml': WORKSPACE_YAML,
    });

    const detail = getDetail(noPnpmFieldInPackageJson(dir));
    expect(detail).toContain('2 found');
    expect(detail).toContain('package.json (overrides, patchedDependencies)');
    expect(detail).toContain('packages/api/package.json (overrides)');
  });

  // The field is the subject, so an empty one is still a declaration; there is simply no key to name.
  it('reports a pnpm field holding no keys by path alone', () => {
    const dir = buildRepo({ 'package.json': '{ "pnpm": {} }\n' });

    expect(getDetail(noPnpmFieldInPackageJson(dir))).toContain('package.json');
    expect(getDetail(noPnpmFieldInPackageJson(dir))).not.toContain('(');
  });

  it('ignores a manifest inside a nested node_modules', () => {
    const dir = buildRepo({
      'package.json': '{ "name": "root" }\n',
      'packages/api/node_modules/dep/package.json': '{ "pnpm": { "overrides": { "tar": "1" } } }\n',
    });

    expect(noPnpmFieldInPackageJson(dir)).toBe(true);
  });

  it('skips a manifest that does not parse and still reports a declaring sibling', () => {
    const dir = buildRepo({
      'package.json': '{ "name": "root",\n',
      'packages/api/package.json': '{ "pnpm": { "overrides": { "tar": ">=6.2.1" } } }\n',
    });

    const detail = getDetail(noPnpmFieldInPackageJson(dir));
    expect(detail).toContain('1 found');
    expect(detail).toContain('packages/api/package.json (overrides)');
  });

  // A string where a settings object belongs configures nothing, so it is malformed rather than a dead block.
  it('passes when the pnpm field is not an object', () => {
    const dir = buildRepo({ 'package.json': '{ "pnpm": "workspace" }\n' });

    expect(noPnpmFieldInPackageJson(dir)).toBe(true);
  });
});
