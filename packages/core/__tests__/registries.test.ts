import { describe, expect, it } from 'vitest';

import { getDefaultRootScripts, getDefaultWorkspaceScripts } from '../src/registries.js';

describe('getDefaultWorkspaceScripts', () => {
  it('includes all expected default workspace scripts', () => {
    const scripts = getDefaultWorkspaceScripts(false);

    expect(scripts.build).toEqual(['compile', 'generate-typings']);
    expect(scripts.check).toEqual(['typecheck', 'fmt:check', 'lint:check', 'test']);
    expect(scripts.clean).toBe('pnpm exec rimraf dist/*');
    expect(scripts.compile).toBe('tsx ../../config/build.ts');
    expect(scripts.typecheck).toBe('tsgo --noEmit');
  });

  it('uses standard test scripts when --int-test is false', () => {
    const scripts = getDefaultWorkspaceScripts(false);

    expect(scripts.test).toBe('pnpm exec vitest');
    expect(scripts['test:coverage']).toBe('pnpm exec vitest --coverage');
    expect(scripts['test:watch']).toBe('pnpm exec vitest --watch');
    expect(scripts['test:integration']).toBeUndefined();
  });

  it('uses integration test scripts when --int-test is true', () => {
    const scripts = getDefaultWorkspaceScripts(true);

    expect(scripts.test).toBe('pnpm exec vitest --config=vitest.standalone.config.ts');
    expect(scripts['test:coverage']).toBe('pnpm exec vitest --config=vitest.standalone.config.ts --coverage');
    expect(scripts['test:integration']).toBe('pnpm exec vitest --config=vitest.integration.config.ts');
  });
});

describe('getDefaultRootScripts', () => {
  it('includes all expected default root scripts', () => {
    const scripts = getDefaultRootScripts();

    expect(scripts.ci).toEqual(['check:strict', 'build']);
    expect(scripts.check).toEqual(['typecheck', 'fmt:check', 'lint:check', 'test']);
    expect(scripts.audit).toEqual(['audit:prod', 'audit:dev']);
    expect(scripts['report-overrides']).toBe('nmr-report-overrides');
    expect(scripts['sync-pnpm-version']).toBe('nmr-sync-pnpm-version');
  });

  it('composes root scripts that delegate to workspaces', () => {
    const scripts = getDefaultRootScripts();

    expect(scripts.lint).toBe('nmr root:lint && pnpm --recursive exec nmr lint');
    expect(scripts.test).toBe('nmr root:test && pnpm --recursive exec nmr test');
    expect(scripts.typecheck).toBe('nmr root:typecheck && pnpm --recursive exec nmr typecheck');
  });

  it('runs strict-lint against the monorepo root, excluding packages', () => {
    const scripts = getDefaultRootScripts();

    expect(scripts['root:lint:strict']).toBe("strict-lint --ignore-pattern 'packages/**' .");
  });
});
