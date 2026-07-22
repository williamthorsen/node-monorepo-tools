import { describe, expect, it } from 'vitest';

import { getDefaultRootScripts, getDefaultWorkspaceScripts } from '../resolve-scripts.ts';

describe('getDefaultWorkspaceScripts', () => {
  it('includes all expected default workspace scripts', () => {
    const scripts = getDefaultWorkspaceScripts(false);

    expect(scripts.build).toStrictEqual(['compile']);
    expect(scripts.check).toStrictEqual(['typecheck', 'fmt:check', 'lint:check', 'test']);
    expect(scripts['fix:check']).toStrictEqual(['fmt:check', 'lint:check']);
    expect(scripts.clean).toBe('nmr-clean');
    expect(scripts.compile).toBe('nmr-compile');
    expect(scripts.typecheck).toBe('tsgo --noEmit');
  });

  it('builds in a single step with no separate typings script', () => {
    const scripts = getDefaultWorkspaceScripts(false);

    expect(scripts.build).toStrictEqual(['compile']);
    expect(scripts['generate-typings']).toBeUndefined();
  });

  it('uses standard test scripts when useIntTests is false', () => {
    const scripts = getDefaultWorkspaceScripts(false);

    expect(scripts.test).toBe('pnpm exec vitest');
    expect(scripts['test:coverage']).toBe('pnpm exec vitest --coverage');
    expect(scripts['test:watch']).toBe('pnpm exec vitest --watch');
    expect(scripts['test:integration']).toBeUndefined();
    expect(scripts['test:all']).toBeUndefined();
  });

  it('uses integration test scripts when useIntTests is true', () => {
    const scripts = getDefaultWorkspaceScripts(true);

    expect(scripts.test).toBe('pnpm exec vitest --config=vitest.standalone.config.ts');
    expect(scripts['test:coverage']).toBe('pnpm exec vitest --config=vitest.standalone.config.ts --coverage');
    expect(scripts['test:integration']).toBe('pnpm exec vitest --config=vitest.integration.config.ts');
    expect(scripts['test:all']).toBe('pnpm exec vitest');
  });

  // A workspace-context upgrade scans the cwd package alone; the recursive sweep is the root registry's.
  it('upgrades the current package without recursing', () => {
    const scripts = getDefaultWorkspaceScripts(false);

    expect(scripts.upgrade).toBe('nmr-taze --include-locked');
  });
});

describe('getDefaultRootScripts', () => {
  it('includes all expected default root scripts', () => {
    const scripts = getDefaultRootScripts();

    expect(scripts.audit).toStrictEqual(['audit:prod', 'audit:dev']);
    expect(scripts.check).toStrictEqual(['typecheck', 'fmt:check', 'lint:check', 'test']);
    expect(scripts['fix:check']).toStrictEqual(['fmt:check', 'lint:check']);
    expect(scripts.ci).toStrictEqual(['build', 'check:strict', 'audit']);
    expect(scripts.clean).toBe('nmr-clean');
    expect(scripts['fmt:all']).toStrictEqual(['fmt', 'fmt:sh']);
    expect(scripts['fmt:sh']).toBe('shfmt --write **/*.sh');
    expect(scripts['root:check']).toStrictEqual(['root:typecheck', 'fmt:check', 'root:lint:check', 'root:test']);
    expect(scripts['report-overrides']).toBe('nmr-report-overrides');
    expect(scripts['sync-pnpm-version']).toBe('nmr-sync-pnpm-version');
  });

  it('excludes audit from check:strict', () => {
    const scripts = getDefaultRootScripts();
    const checkStrict = scripts['check:strict'];

    expect(checkStrict).toStrictEqual(['typecheck', 'fmt:check', 'lint:strict', 'test:coverage', 'check:agent-files']);
    expect(checkStrict).not.toContain('audit');
  });

  it('includes audit in ci after check:strict', () => {
    const scripts = getDefaultRootScripts();
    const ci = scripts.ci;

    expect(ci).toStrictEqual(['build', 'check:strict', 'audit']);
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

  it('sweeps every package on upgrade, and the root alone on root:upgrade', () => {
    const scripts = getDefaultRootScripts();

    expect(scripts.upgrade).toBe('nmr-taze --include-locked --recursive');
    expect(scripts['root:upgrade']).toBe('nmr-taze --include-locked');
  });
});
