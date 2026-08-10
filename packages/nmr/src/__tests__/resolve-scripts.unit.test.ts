import { assert, describe, expect, it } from 'vitest';

import { getDefaultRootScripts, getDefaultWorkspaceScripts } from '../resolve-scripts.ts';

describe(getDefaultWorkspaceScripts, () => {
  it('includes all expected default workspace scripts', () => {
    const scripts = getDefaultWorkspaceScripts();

    expect(scripts).toMatchObject({
      build: ['compile'],
      check: ['typecheck', 'fmt:check', 'lint:check', 'test'],
      clean: 'nmr-clean',
      compile: 'nmr-compile',
      'fix:check': ['fmt:check', 'lint:check'],
      fmt: 'nmr-fmt --write',
      'fmt:check': 'nmr-fmt --check',
      typecheck: 'tsgo --noEmit',
    });
  });

  it('builds in a single step with no separate typings script', () => {
    const scripts = getDefaultWorkspaceScripts();

    expect(scripts['build']).toStrictEqual(['compile']);
    expect(scripts['generate-typings']).toBeUndefined();
  });

  it('selects Vitest projects, exposing all six test commands to every package', () => {
    const scripts = getDefaultWorkspaceScripts();

    expect(scripts).toMatchObject({
      test: 'pnpm exec vitest --project unit --project tool',
      'test:all': 'pnpm exec vitest',
      'test:coverage': 'pnpm exec vitest --project unit --project tool --coverage',
      'test:tool': 'pnpm exec vitest --project tool',
      'test:unit': 'pnpm exec vitest --project unit',
      'test:watch': 'pnpm exec vitest --project unit --project tool --watch',
    });
  });

  // Declares no override report either: `pnpm.overrides` is declared in the root `package.json` alone.
  it('upgrades the current package without recursing', () => {
    const scripts = getDefaultWorkspaceScripts();

    expect(scripts['upgrade']).toBe('nmr-taze --include-locked');
    expect(scripts['report-overrides']).toBeUndefined();
  });
});

describe(getDefaultRootScripts, () => {
  it('includes all expected default root scripts', () => {
    const scripts = getDefaultRootScripts();

    expect(scripts).toMatchObject({
      audit: ['audit:prod', 'audit:dev'],
      check: ['typecheck', 'fmt:check', 'lint:check', 'test'],
      'check:strict': ['typecheck', 'fmt:check', 'lint:strict', 'test:coverage'],
      ci: ['build', 'check:strict'],
      clean: 'nmr-clean',
      'fix:check': ['fmt:check', 'lint:check'],
      fmt: 'nmr-fmt --write',
      'fmt:check': 'nmr-fmt --check',
      'report-overrides': 'nmr-report-overrides',
      'root:check': ['root:typecheck', 'fmt:check', 'root:lint:check', 'root:test'],
    });
  });

  // Overrides are reported while reviewing dependencies, not on every check run.
  it.each(['check', 'check:strict', 'root:check'])('leaves %s without an override report', (name) => {
    expect(getDefaultRootScripts()[name]).not.toContain('report-overrides');
  });

  // Two invariants: the audit gates the run, and `prepush` names `ci` so a stage added to `ci` joins the pre-push run.
  it('composes prepush from audit and ci, in that order', () => {
    const scripts = getDefaultRootScripts();

    expect(scripts['prepush']).toStrictEqual(['audit', 'ci']);
  });

  it('composes root scripts that delegate to workspaces', () => {
    const scripts = getDefaultRootScripts();

    expect(scripts).toMatchObject({
      test: ['root:test', '-R test'],
      typecheck: ['root:typecheck', '-R typecheck'],
    });
  });

  it('lints the whole tree in one process, delegating to no workspace', () => {
    const scripts = getDefaultRootScripts();

    expect(scripts).toMatchObject({
      lint: 'eslint --fix .',
      'lint:check': 'eslint .',
      'lint:strict': 'strict-lint',
    });
  });

  // The root registry's lint commands cover the tree the workspace registry's cover one package of, so the two
  // resolve to the same string: a divergence would mean one scope had picked up a flag the other lacks.
  it('gives root and workspace lint commands the same form', () => {
    const rootScripts = getDefaultRootScripts();
    const workspaceScripts = getDefaultWorkspaceScripts();

    for (const name of ['lint', 'lint:check', 'lint:strict']) {
      expect(rootScripts[name]).toBe(workspaceScripts[name]);
    }
  });

  // Retained as the isolate-to-root-code counterparts of the collapsed commands, mirroring `root:test`.
  it('scopes each root-only lint command away from packages', () => {
    const scripts = getDefaultRootScripts();

    expect(scripts).toMatchObject({
      'root:lint': "eslint --fix --ignore-pattern 'packages/**' .",
      'root:lint:check': "eslint --ignore-pattern 'packages/**' .",
      'root:lint:strict': "strict-lint --ignore-pattern 'packages/**' .",
    });
  });

  it('fans every test selection out to the root and to each package', () => {
    const scripts = getDefaultRootScripts();

    expect(scripts).toMatchObject({
      test: ['root:test', '-R test'],
      'test:all': ['root:test:all', '-R test:all'],
      'test:coverage': ['root:test', '-R test:coverage'],
      'test:tool': ['root:test:tool', '-R test:tool'],
      'test:unit': ['root:test:unit', '-R test:unit'],
    });
  });

  it('scopes each root-only test selection to the root config', () => {
    const scripts = getDefaultRootScripts();

    expect(scripts).toMatchObject({
      'root:test': 'vitest --config ./vitest.root.config.ts --project unit --project tool',
      'root:test:all': 'vitest --config ./vitest.root.config.ts',
      'root:test:tool': 'vitest --config ./vitest.root.config.ts --project tool',
      'root:test:unit': 'vitest --config ./vitest.root.config.ts --project unit',
    });
  });

  // Every selection carrying a `root:` form is what lets a failure be isolated to root code rather than a package.
  it('gives each chained test selection a root-only counterpart', () => {
    const scripts = getDefaultRootScripts();

    for (const name of ['test', 'test:all', 'test:tool', 'test:unit']) {
      expect(scripts).toHaveProperty(`root:${name}`);
    }
  });

  it('watches the whole tree from one process, running the default gate alone', () => {
    expect(getDefaultRootScripts()['test:watch']).toBe('vitest --project unit --project tool --watch');
  });

  it('sweeps every package on upgrade, and the root alone on root:upgrade', () => {
    const scripts = getDefaultRootScripts();

    expect(scripts).toMatchObject({
      'root:upgrade': 'nmr-taze --include-locked',
      upgrade: 'nmr-report-overrides && nmr-taze --include-locked --recursive',
    });
  });

  // A string script runs with the invocation cwd, so an `nmr <command>` step re-derives its registry from
  // there: under `-w` from a package dir the child would look for a root-only command in the workspace
  // registry and exit 1, and `&&` would swallow the upgrade report behind it. Bins locate the root themselves.
  it('chains only bins, so upgrade survives -w from a package cwd', () => {
    const upgrade = getDefaultRootScripts()['upgrade'];
    assert(typeof upgrade === 'string', 'Expected upgrade to be a chained command');

    for (const step of upgrade.split('&&')) {
      expect(step.trim()).not.toMatch(/^nmr\s/);
    }
  });

  it('reports overrides before the upgrade report', () => {
    const upgrade = getDefaultRootScripts()['upgrade'];
    assert(typeof upgrade === 'string', 'Expected upgrade to be a chained command');

    expect(upgrade.indexOf('report-overrides')).toBeLessThan(upgrade.indexOf('nmr-taze'));
  });

  it('ends the upgrade chain with the upgrade tool so passthrough args reach it', () => {
    const upgrade = getDefaultRootScripts()['upgrade'];
    assert(typeof upgrade === 'string', 'Expected upgrade to be a chained command');

    expect(upgrade.split('&&').at(-1)?.trim()).toBe('nmr-taze --include-locked --recursive');
  });
});
