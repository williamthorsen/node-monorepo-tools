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
  // It reports no overrides either: `pnpm.overrides` is declared in the root `package.json` alone.
  it('upgrades the current package without recursing', () => {
    const scripts = getDefaultWorkspaceScripts(false);

    expect(scripts.upgrade).toBe('nmr-taze --include-locked');
    expect(scripts['report-overrides']).toBeUndefined();
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
    expect(scripts['sync-agent-files']).toBe('nmr-sync-agent-files');
  });

  it('excludes audit from check:strict', () => {
    const scripts = getDefaultRootScripts();
    const checkStrict = scripts['check:strict'];

    expect(checkStrict).toStrictEqual(['typecheck', 'fmt:check', 'lint:strict', 'test:coverage', 'check:agent-files']);
    expect(checkStrict).not.toContain('audit');
  });

  // Overrides are reported while reviewing dependencies, not on every check run.
  it.each(['check', 'check:strict', 'root:check'])('leaves %s without an override report', (name) => {
    expect(getDefaultRootScripts()[name]).not.toContain('report-overrides');
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

    expect(scripts.upgrade).toBe('nmr-report-overrides && nmr-taze --include-locked --recursive');
    expect(scripts['root:upgrade']).toBe('nmr-taze --include-locked');
  });

  // A string script runs with the invocation cwd, so an `nmr <command>` step re-derives its registry from
  // there: under `-w` from a package dir the child would look for a root-only command in the workspace
  // registry and exit 1, and `&&` would swallow the upgrade report behind it. Bins locate the root themselves.
  it('chains only bins, so upgrade survives -w from a package cwd', () => {
    const upgrade = getDefaultRootScripts().upgrade;
    if (typeof upgrade !== 'string') throw new Error('Expected upgrade to be a chained command');

    for (const step of upgrade.split('&&')) {
      expect(step.trim()).not.toMatch(/^nmr\s/);
    }
  });

  // A pinned transitive dependency is why an expected upgrade may be missing from the report, so the
  // override list has to precede it.
  it('reports overrides before the upgrade report', () => {
    const upgrade = getDefaultRootScripts().upgrade;
    if (typeof upgrade !== 'string') throw new Error('Expected upgrade to be a chained command');

    expect(upgrade.indexOf('report-overrides')).toBeLessThan(upgrade.indexOf('nmr-taze'));
  });

  // Passthrough args attach to the last command in the chain, so the upgrade tool has to end it:
  // as a composite, `nmr upgrade major` would hand `major` to the override report instead.
  it('ends the upgrade chain with the upgrade tool so passthrough args reach it', () => {
    const upgrade = getDefaultRootScripts().upgrade;
    if (typeof upgrade !== 'string') throw new Error('Expected upgrade to be a chained command');

    expect(upgrade.split('&&').at(-1)?.trim()).toBe('nmr-taze --include-locked --recursive');
  });
});
