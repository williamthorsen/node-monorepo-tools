import { describe, expect, it } from 'vitest';

import { cataloguedDependenciesUseCatalog } from '../../.readyup/kits/default.ts';
import { buildManifest } from '../test-utils/buildManifest.ts';
import { getDetail } from '../test-utils/getDetail.ts';
import { useMonorepo } from '../test-utils/useMonorepo.ts';

const CATALOG_YAML = 'packages:\n  - packages/*\n\ncatalog:\n  zod: 4.4.3\n\ncatalogs:\n  legacy:\n    chalk: 4.1.2\n';

describe(cataloguedDependenciesUseCatalog, () => {
  it('passes when every catalogued dependency uses the catalog protocol', () => {
    useMonorepo({
      'packages/tool/package.json': buildManifest({
        dependencies: { chalk: 'catalog:legacy', zod: 'catalog:' },
        devDependencies: { vitest: '4.1.11' },
      }),
      'pnpm-workspace.yaml': CATALOG_YAML,
    });

    expect(cataloguedDependenciesUseCatalog()).toBe(true);
  });

  it('passes a repo that declares no catalog', () => {
    useMonorepo({ 'packages/tool/package.json': buildManifest({ dependencies: { zod: '4.4.3' } }) });

    expect(cataloguedDependenciesUseCatalog()).toBe(true);
  });

  it('reports each literal specifier with its manifest, package, and specifier', () => {
    useMonorepo({
      'packages/tool/package.json': buildManifest({
        devDependencies: { zod: '^4.4.0' },
        optionalDependencies: { chalk: '4.1.2' },
      }),
      'pnpm-workspace.yaml': CATALOG_YAML,
    });

    const detail = getDetail(cataloguedDependenciesUseCatalog());
    expect(detail).toContain('2 found');
    expect(detail).toContain('packages/tool/package.json: chalk 4.1.2');
    expect(detail).toContain('packages/tool/package.json: zod ^4.4.0');
  });

  it('checks the root manifest before the workspace manifests', () => {
    useMonorepo({
      'package.json': '{ "name": "fixture-root", "private": true, "devDependencies": { "zod": "4.4.3" } }\n',
      'packages/tool/package.json': buildManifest({ dependencies: { zod: '4.4.3' } }),
      'pnpm-workspace.yaml': CATALOG_YAML,
    });

    const lines = getDetail(cataloguedDependenciesUseCatalog())
      .split('\n')
      .map((line) => line.trim());
    expect(lines.slice(1)).toStrictEqual(['package.json: zod 4.4.3', 'packages/tool/package.json: zod 4.4.3']);
  });

  it('leaves peer ranges and other protocols alone', () => {
    useMonorepo({
      'packages/tool/package.json': buildManifest({
        dependencies: { chalk: 'npm:chalk@5.0.0' },
        devDependencies: { zod: 'workspace:*' },
        peerDependencies: { zod: '>=4 <5' },
      }),
      'pnpm-workspace.yaml': CATALOG_YAML,
    });

    expect(cataloguedDependenciesUseCatalog()).toBe(true);
  });

  it('fails with the parse error when pnpm-workspace.yaml does not parse', () => {
    useMonorepo({ 'pnpm-workspace.yaml': 'packages: [\n' });

    expect(getDetail(cataloguedDependenciesUseCatalog())).toContain('cannot parse pnpm-workspace.yaml');
  });
});
