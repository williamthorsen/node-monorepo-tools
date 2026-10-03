import { describe, expect, it } from 'vitest';

import { noWorkspacesFieldInPackageJson } from '../../.readyup/kits/default.ts';
import { buildRepo } from '../test-utils/fixture-repo.ts';
import { getDetail } from '../test-utils/getDetail.ts';

describe(noWorkspacesFieldInPackageJson, () => {
  it('passes when no manifest declares workspaces', () => {
    const dir = buildRepo({
      'package.json': '{ "name": "root" }\n',
      'packages/api/package.json': '{ "name": "api" }\n',
    });

    expect(noWorkspacesFieldInPackageJson(dir)).toBe(true);
  });

  it('reports each manifest that declares workspaces, the root included', () => {
    const dir = buildRepo({
      'package.json': '{ "name": "root", "workspaces": ["packages/*"] }\n',
      'packages/api/package.json': '{ "name": "api", "workspaces": [] }\n',
    });

    const lines = getDetail(noWorkspacesFieldInPackageJson(dir))
      .split('\n')
      .map((line) => line.trim());
    expect(lines).toStrictEqual(['2 found:', 'package.json', 'packages/api/package.json']);
  });

  it('ignores a manifest that does not parse', () => {
    const dir = buildRepo({ 'package.json': '{ "workspaces": [\n' });

    expect(noWorkspacesFieldInPackageJson(dir)).toBe(true);
  });
});
