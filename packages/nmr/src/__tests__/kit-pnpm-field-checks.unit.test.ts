import { describe, expect, it } from 'vitest';

import { noPnpmFieldInPackageJson } from '../../.readyup/kits/default.ts';
import { buildRepo } from '../test-utils/fixture-repo.ts';
import { getDetail } from '../test-utils/getDetail.ts';

const WORKSPACE_YAML = "packages:\n  - packages/*\n\noverrides:\n  tar: '>=6.2.1'\n";

describe(noPnpmFieldInPackageJson, () => {
  it('passes when the overrides live in pnpm-workspace.yaml alone', () => {
    const dir = buildRepo({
      'package.json': '{ "name": "root" }\n',
      'packages/api/package.json': '{ "name": "api" }\n',
      'pnpm-workspace.yaml': WORKSPACE_YAML,
    });

    expect(noPnpmFieldInPackageJson(dir)).toBe(true);
  });

  // The fixture writes its keys out of order and the assertion names them sorted, which pins the sort that makes two
  // repos declaring the same keys render alike.
  it('reports the root and workspace manifests together, each with the keys that it declares', () => {
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

  // The field is the subject, so an empty one is still a declaration; it simply does not contain any key to name.
  it('reports by path alone a pnpm field that does not contain any keys', () => {
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
