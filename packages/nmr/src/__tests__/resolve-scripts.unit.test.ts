import { assert, describe, expect, it } from 'vitest';

import { getDefaultRootScripts, getDefaultWorkspaceScripts } from '../resolve-scripts.ts';
import { findNmrCrossing } from '../steps.ts';

/** The root commands that end in the upgrade tool, and so carry the same chain invariants. */
const UPGRADE_COMMANDS = ['upgrade', 'root:upgrade'] as const;

describe(getDefaultWorkspaceScripts, () => {
  it('includes all expected default workspace scripts', () => {
    const scripts = getDefaultWorkspaceScripts();

    expect(scripts).toMatchObject({
      build: ['compile'],
      check: [{ run: 'typecheck', declinesArgs: true }, 'fmt:check', 'lint:check', 'test'],
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

  // Declares no override report: an override is declared at the monorepo root alone.
  it('upgrades the current package without recursing', () => {
    const scripts = getDefaultWorkspaceScripts();

    expect(scripts['upgrade']).toBe('nmr-report-catalog && nmr-taze --include-locked');
    expect(scripts['report-overrides']).toBeUndefined();
  });

  it('reports the catalog before the upgrade report', () => {
    const upgrade = getDefaultWorkspaceScripts()['upgrade'];
    assert(typeof upgrade === 'string', 'Expected upgrade to be a chained command');

    expect(upgrade.indexOf('report-catalog')).toBeLessThan(upgrade.indexOf('nmr-taze'));
  });

  it('chains only bins on upgrade, so no step spawns a second nmr', () => {
    const upgrade = getDefaultWorkspaceScripts()['upgrade'];
    assert(typeof upgrade === 'string', 'Expected upgrade to be a chained command');

    for (const step of upgrade.split('&&')) {
      expect(step.trim()).not.toMatch(/^nmr\s/);
    }
  });

  it('ends the upgrade chain with the upgrade tool so passthrough args reach it', () => {
    const upgrade = getDefaultWorkspaceScripts()['upgrade'];
    assert(typeof upgrade === 'string', 'Expected upgrade to be a chained command');

    expect(upgrade.split('&&').at(-1)?.trim()).toBe('nmr-taze --include-locked');
  });

  it('exposes the catalog report as a command of its own', () => {
    expect(getDefaultWorkspaceScripts()['report-catalog']).toBe('nmr-report-catalog');
  });
});

describe(getDefaultRootScripts, () => {
  it('includes all expected default root scripts', () => {
    const scripts = getDefaultRootScripts();

    expect(scripts).toMatchObject({
      audit: ['audit:prod', 'audit:dev'],
      check: [{ run: 'typecheck', declinesArgs: true }, 'fmt:check', 'lint:check', 'test'],
      'check:strict': [{ run: 'typecheck', declinesArgs: true }, 'fmt:check', 'lint:strict', 'test:coverage'],
      ci: [{ run: 'build', declinesArgs: true }, 'check:strict'],
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

    expect(scripts['prepush']).toStrictEqual([{ run: 'audit', declinesArgs: true }, 'ci']);
  });

  it('composes root scripts that delegate to workspaces', () => {
    const scripts = getDefaultRootScripts();

    expect(scripts).toMatchObject({
      test: ['root:test', '-R test'],
      typecheck: [
        { run: 'root:typecheck', declinesArgs: true },
        { run: '-R typecheck', declinesArgs: true },
      ],
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
      'root:upgrade': 'nmr-report-overrides && nmr-taze --include-locked',
      upgrade: 'nmr-report-overrides && nmr-taze --include-locked --recursive',
    });
  });

  // A string script runs with the invocation cwd, so an `nmr <command>` step re-derives its registry from
  // there: under `-w` from a package dir the child would look for a root-only command in the workspace
  // registry and exit 1, and `&&` would swallow the upgrade report behind it. Bins locate the root themselves.
  it.each(UPGRADE_COMMANDS)('chains only bins on %s, so it survives -w from a package cwd', (command) => {
    const chain = readChain(command);

    for (const step of chain.split('&&')) {
      expect(step.trim()).not.toMatch(/^nmr\s/);
    }
  });

  // Both invocations reach the upgrade tool, which rewrites a `pnpm.overrides` block the reporter rejects.
  it.each(UPGRADE_COMMANDS)('reports overrides before the %s report', (command) => {
    const chain = readChain(command);

    expect(chain.indexOf('report-overrides')).toBeLessThan(chain.indexOf('nmr-taze'));
  });

  it.each(UPGRADE_COMMANDS)('ends the %s chain with the upgrade tool so passthrough args reach it', (command) => {
    expect(readChain(command).split('&&').at(-1)?.trim()).toMatch(/^nmr-taze /);
  });
});

// A default reaching nmr through a shell would be an nmr defect rather than a consumer's, which is what the
// shelled-nmr diagnostic's tier-1 remedy says. This keeps that remedy unreachable.
describe('the built-in defaults', () => {
  it.each([
    { registry: getDefaultRootScripts(), scenario: 'root' },
    { registry: getDefaultWorkspaceScripts(), scenario: 'workspace' },
  ])('reach nmr through no shell in the $scenario registry', ({ registry }) => {
    for (const [command, script] of Object.entries(registry)) {
      if (typeof script !== 'string') continue;

      expect(findNmrCrossing([{ kind: 'opaque', command: script }]), command).toBeUndefined();
    }
  });
});

// region | Helpers

/** Returns a root command's chain, rejecting a registry entry that is not one. */
function readChain(command: string): string {
  const chain = getDefaultRootScripts()[command];
  assert(typeof chain === 'string', `Expected ${command} to be a chained command`);

  return chain;
}

// endregion | Helpers
