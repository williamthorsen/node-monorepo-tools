import { assert, describe, expect, it } from 'vitest';

import { getDefaultRootScripts, getDefaultWorkspaceScripts } from '../resolve-scripts.ts';
import { findNmrCrossing } from '../steps.ts';
import { buildMonorepo, buildRepo } from '../test-utils/fixture-repo.ts';

/** A directory without `pnpm-workspace.yaml`, for which the root lint commands do not exclude anything. */
const NON_WORKSPACE_DIR = import.meta.dirname;

/** The root commands that end in the upgrade tool, and so share the same chain invariants. */
const UPGRADE_COMMANDS = ['upgrade', 'root:upgrade'] as const;

describe(getDefaultWorkspaceScripts, () => {
  it('includes all expected default workspace scripts', () => {
    const scripts = getDefaultWorkspaceScripts();

    expect(scripts).toMatchObject({
      build: ['compile'],
      check: [{ run: 'typecheck', shouldDeclineArguments: true }, 'fmt:check', 'lint:check', 'test'],
      'check:strict': [{ run: 'typecheck', shouldDeclineArguments: true }, 'fmt:check', 'lint:strict', 'test'],
      clean: 'nmr-clean',
      compile: 'nmr-compile',
      'fix:check': ['fmt:check', 'lint:check'],
      fmt: 'nmr-fmt --write',
      'fmt:check': 'nmr-fmt --check',
      typecheck: 'tsgo --noEmit',
    });
  });

  it('builds in a single step without a separate typings script', () => {
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

  // The workspace registry doesn't declare an override report: An override is declared at the monorepo root alone.
  it('upgrades the current package without recursing', () => {
    const scripts = getDefaultWorkspaceScripts();

    expect(scripts['upgrade']).toBe('nmr-report-catalog && nmr-taze');
    expect(scripts['report-overrides']).toBeUndefined();
  });

  it('reports the catalog before the upgrade report', () => {
    const upgradeScript = getDefaultWorkspaceScripts()['upgrade'];
    assert(typeof upgradeScript === 'string', 'Expected upgrade to be a chained command');

    expect(upgradeScript.indexOf('report-catalog')).toBeLessThan(upgradeScript.indexOf('nmr-taze'));
  });

  it('chains only bins on upgrade, so its steps do not spawn a second nmr', () => {
    const upgradeScript = getDefaultWorkspaceScripts()['upgrade'];
    assert(typeof upgradeScript === 'string', 'Expected upgrade to be a chained command');

    for (const step of upgradeScript.split('&&')) {
      expect(step.trim()).not.toMatch(/^nmr\s/);
    }
  });

  it('ends the upgrade chain with the upgrade tool so that it receives passthrough args', () => {
    const upgradeScript = getDefaultWorkspaceScripts()['upgrade'];
    assert(typeof upgradeScript === 'string', 'Expected upgrade to be a chained command');

    expect(upgradeScript.split('&&').at(-1)?.trim()).toBe('nmr-taze');
  });

  it('exposes the catalog report as a command of its own', () => {
    expect(getDefaultWorkspaceScripts()['report-catalog']).toBe('nmr-report-catalog');
  });
});

describe(getDefaultRootScripts, () => {
  it('includes all expected default root scripts', () => {
    const scripts = getDefaultRootScripts(NON_WORKSPACE_DIR);

    expect(scripts).toMatchObject({
      audit: ['audit:prod', 'audit:dev'],
      check: [{ run: 'typecheck', shouldDeclineArguments: true }, 'fmt:check', 'lint:check', 'test'],
      'check:strict': [{ run: 'typecheck', shouldDeclineArguments: true }, 'fmt:check', 'lint:strict', 'test'],
      ci: [{ run: 'build', shouldDeclineArguments: true }, 'check:strict'],
      clean: 'nmr-clean',
      'fix:check': ['fmt:check', 'lint:check'],
      fmt: 'nmr-fmt --write',
      'fmt:check': 'nmr-fmt --check',
      'report-overrides': 'nmr-report-overrides',
      'root:check': [
        { run: 'root:typecheck', shouldDeclineArguments: true },
        'fmt:check',
        'root:lint:check',
        'root:test',
      ],
    });
  });

  // Overrides are reported while reviewing dependencies, not on every check run.
  it.each(['check', 'check:strict', 'root:check'])('leaves %s without an override report', (name) => {
    expect(getDefaultRootScripts(NON_WORKSPACE_DIR)[name]).not.toContain('report-overrides');
  });

  // Two invariants: The audit gates the run, and `prepush` names `ci` so that the pre-push run includes any stage
  // added to `ci`.
  it('composes prepush from audit and ci, in that order', () => {
    const scripts = getDefaultRootScripts(NON_WORKSPACE_DIR);

    expect(scripts['prepush']).toStrictEqual([{ run: 'audit', shouldDeclineArguments: true }, 'ci']);
  });

  it('composes root scripts that delegate to workspaces', () => {
    const scripts = getDefaultRootScripts(NON_WORKSPACE_DIR);

    expect(scripts).toMatchObject({
      test: ['root:test', '-R test'],
      typecheck: [
        { run: 'root:typecheck', shouldDeclineArguments: true },
        { run: '-R typecheck', shouldDeclineArguments: true },
      ],
    });
  });

  it('lints the whole tree in one process, without delegating to any workspace', () => {
    const scripts = getDefaultRootScripts(NON_WORKSPACE_DIR);

    expect(scripts).toMatchObject({
      lint: 'eslint --fix .',
      'lint:check': 'eslint .',
      'lint:strict': 'strict-lint',
    });
  });

  // The root registry's lint commands cover the tree, and the workspace registry's cover one package of it, so the
  // two resolve to the same string: a divergence would mean that one scope had picked up a flag that the other lacks.
  it('gives root and workspace lint commands the same form', () => {
    const rootScripts = getDefaultRootScripts(NON_WORKSPACE_DIR);
    const workspaceScripts = getDefaultWorkspaceScripts();

    for (const name of ['lint', 'lint:check', 'lint:strict']) {
      expect(rootScripts[name]).toBe(workspaceScripts[name]);
    }
  });

  // A root-only lint command isolates a failure to root code, as `root:test` does.
  it('scopes each root-only lint command away from every package', () => {
    const root = buildMonorepo({
      'packages/a/package.json': '{ "name": "a" }\n',
      'packages/b/package.json': '{ "name": "b" }\n',
    });

    expect(getDefaultRootScripts(root)).toMatchObject({
      'root:lint': "eslint --fix --ignore-pattern 'packages/a/**' --ignore-pattern 'packages/b/**' .",
      'root:lint:check': "eslint --ignore-pattern 'packages/a/**' --ignore-pattern 'packages/b/**' .",
      'root:lint:strict': "strict-lint --ignore-pattern 'packages/a/**' --ignore-pattern 'packages/b/**' .",
    });
  });

  it('excludes the packages of every workspace glob, not only packages/*', () => {
    const root = buildMonorepo({
      'apps/web/package.json': '{ "name": "web" }\n',
      'packages/lib/package.json': '{ "name": "lib" }\n',
      'pnpm-workspace.yaml': 'packages:\n  - apps/*\n  - packages/*\n',
    });

    expect(getDefaultRootScripts(root)['root:lint:check']).toBe(
      "eslint --ignore-pattern 'apps/web/**' --ignore-pattern 'packages/lib/**' .",
    );
  });

  it('lints a directory that a negated workspace pattern excludes', () => {
    const root = buildMonorepo({
      'packages/kept/package.json': '{ "name": "kept" }\n',
      'packages/legacy/package.json': '{ "name": "legacy" }\n',
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n  - "!packages/legacy"\n',
    });

    expect(getDefaultRootScripts(root)['root:lint:check']).toBe("eslint --ignore-pattern 'packages/kept/**' .");
  });

  // A glob for the root itself would match every root file and leave the command with nothing to lint.
  it('does not exclude the root when a workspace pattern matches it', () => {
    const root = buildMonorepo({
      'packages/a/package.json': '{ "name": "a" }\n',
      'pnpm-workspace.yaml': "packages:\n  - '.'\n  - packages/*\n",
    });

    expect(getDefaultRootScripts(root)['root:lint:check']).toBe("eslint --ignore-pattern 'packages/a/**' .");
  });

  it.each([
    { buildRoot: () => buildMonorepo({}), scenario: 'a workspace without packages' },
    { buildRoot: () => buildRepo({ 'package.json': '{}\n' }), scenario: 'a directory without pnpm-workspace.yaml' },
  ])('lints the whole tree from the root of $scenario', ({ buildRoot }) => {
    expect(getDefaultRootScripts(buildRoot())).toMatchObject({
      'root:lint': 'eslint --fix .',
      'root:lint:check': 'eslint .',
      'root:lint:strict': 'strict-lint .',
    });
  });

  it('fans every test selection out to the root and to each package', () => {
    const scripts = getDefaultRootScripts(NON_WORKSPACE_DIR);

    expect(scripts).toMatchObject({
      test: ['root:test', '-R test'],
      'test:all': ['root:test:all', '-R test:all'],
      'test:coverage': ['root:test', '-R test:coverage'],
      'test:tool': ['root:test:tool', '-R test:tool'],
      'test:unit': ['root:test:unit', '-R test:unit'],
    });
  });

  it('scopes each root-only test selection to the root config', () => {
    const scripts = getDefaultRootScripts(NON_WORKSPACE_DIR);

    expect(scripts).toMatchObject({
      'root:test': 'vitest --config ./vitest.root.config.ts --project unit --project tool',
      'root:test:all': 'vitest --config ./vitest.root.config.ts',
      'root:test:tool': 'vitest --config ./vitest.root.config.ts --project tool',
      'root:test:unit': 'vitest --config ./vitest.root.config.ts --project unit',
    });
  });

  // Because every selection has a `root:` form, a failure can be isolated to root code rather than a package.
  it('gives each chained test selection a root-only counterpart', () => {
    const scripts = getDefaultRootScripts(NON_WORKSPACE_DIR);

    for (const name of ['test', 'test:all', 'test:tool', 'test:unit']) {
      expect(scripts).toHaveProperty(`root:${name}`);
    }
  });

  it('watches the whole tree from one process, running the default gate alone', () => {
    expect(getDefaultRootScripts(NON_WORKSPACE_DIR)['test:watch']).toBe('vitest --project unit --project tool --watch');
  });

  it('sweeps every package on upgrade, and the root alone on root:upgrade', () => {
    const scripts = getDefaultRootScripts(NON_WORKSPACE_DIR);

    expect(scripts).toMatchObject({
      'root:upgrade': 'nmr-report-overrides && nmr-taze',
      upgrade: 'nmr-report-overrides && nmr-taze --recursive',
    });
  });

  // A string script runs with the invocation cwd, so an `nmr <command>` step re-derives its registry from
  // there: under `-w` from a package dir the child would look for a root-only command in the workspace
  // registry and exit 1, and `&&` would skip the upgrade report after it. Bins locate the root themselves.
  it.each(UPGRADE_COMMANDS)('chains only bins on %s, keeping it working under -w from a package cwd', (command) => {
    const chain = readChain(command);

    for (const step of chain.split('&&')) {
      expect(step.trim()).not.toMatch(/^nmr\s/);
    }
  });

  // Both invocations run the upgrade tool, which rewrites a `pnpm.overrides` block that the reporter rejects.
  it.each(UPGRADE_COMMANDS)('reports overrides before the %s report', (command) => {
    const chain = readChain(command);

    expect(chain.indexOf('report-overrides')).toBeLessThan(chain.indexOf('nmr-taze'));
  });

  it.each(UPGRADE_COMMANDS)(
    'ends the %s chain with the upgrade tool so that it receives passthrough args',
    (command) => {
      expect(readChain(command).split('&&').at(-1)?.trim()).toMatch(/^nmr-taze\b/);
    },
  );
});

// A default that invokes nmr through a shell would be an nmr defect rather than a consumer's, as the shelled-nmr
// diagnostic's tier-1 remedy says. This keeps that remedy unreachable.
describe('the built-in defaults', () => {
  it.each([
    { registry: getDefaultRootScripts(NON_WORKSPACE_DIR), scenario: 'root' },
    { registry: getDefaultWorkspaceScripts(), scenario: 'workspace' },
  ])('do not invoke nmr through a shell in the $scenario registry', ({ registry }) => {
    for (const [command, script] of Object.entries(registry)) {
      if (typeof script !== 'string') continue;

      expect(findNmrCrossing([{ kind: 'opaque', command: script }]), command).toBeUndefined();
    }
  });
});

// A step reaching `tsgo --noEmit` is narrowed by a file argument into checking that file under default
// compiler options, which reports on a tsconfig that nobody configured. The sweep is registry-wide because the
// harm follows the command rather than the composite that happens to name it.
describe('every step reaching a typecheck', () => {
  it.each([
    { registry: getDefaultRootScripts(NON_WORKSPACE_DIR), scenario: 'root' },
    { registry: getDefaultWorkspaceScripts(), scenario: 'workspace' },
  ])('declines trailing arguments in the $scenario registry', ({ registry }) => {
    for (const [command, script] of Object.entries(registry)) {
      if (typeof script === 'string') continue;

      for (const element of script) {
        const instruction = typeof element === 'string' ? element : element.run;
        if (!instruction.endsWith('typecheck')) continue;

        expect(
          typeof element === 'string' ? false : element.shouldDeclineArguments,
          `${command} -> ${instruction}`,
        ).toBe(true);
      }
    }
  });
});

// region | Helpers

/** Returns a root command's chain, rejecting a registry entry that is not one. */
function readChain(command: string): string {
  const chain = getDefaultRootScripts(NON_WORKSPACE_DIR)[command];
  assert(typeof chain === 'string', `Expected ${command} to be a chained command`);

  return chain;
}

// endregion | Helpers
