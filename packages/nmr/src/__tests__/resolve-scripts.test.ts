import { describe, expect, it } from 'vitest';

import { getDefaultRootScripts, getDefaultWorkspaceScripts } from '../resolve-scripts.ts';

describe(getDefaultWorkspaceScripts, () => {
  it('includes all expected default workspace scripts', () => {
    const scripts = getDefaultWorkspaceScripts();

    expect(scripts.build).toStrictEqual(['compile']);
    expect(scripts.check).toStrictEqual(['typecheck', 'fmt:check', 'lint:check', 'test']);
    expect(scripts['fix:check']).toStrictEqual(['fmt:check', 'lint:check']);
    expect(scripts.clean).toBe('nmr-clean');
    expect(scripts.compile).toBe('nmr-compile');
    expect(scripts.fmt).toBe('nmr-fmt --write');
    expect(scripts['fmt:check']).toBe('nmr-fmt --check');
    expect(scripts.typecheck).toBe('tsgo --noEmit');
  });

  it('builds in a single step with no separate typings script', () => {
    const scripts = getDefaultWorkspaceScripts();

    expect(scripts.build).toStrictEqual(['compile']);
    expect(scripts['generate-typings']).toBeUndefined();
  });

  it('selects Vitest projects, exposing all six test commands to every package', () => {
    const scripts = getDefaultWorkspaceScripts();

    expect(scripts.test).toBe('pnpm exec vitest --project unit --project tool');
    expect(scripts['test:all']).toBe('pnpm exec vitest');
    expect(scripts['test:coverage']).toBe('pnpm exec vitest --project unit --project tool --coverage');
    expect(scripts['test:tool']).toBe('pnpm exec vitest --project tool');
    expect(scripts['test:unit']).toBe('pnpm exec vitest --project unit');
    expect(scripts['test:watch']).toBe('pnpm exec vitest --project unit --project tool --watch');
  });

  // Naming the tiers rather than negating the skipped ones is what keeps a tier added later out of the default
  // gate until a release opts it in. A negated selection would sweep it in on the release that introduced it.
  it('names the tiers the default gate runs rather than negating the ones it skips', () => {
    const scripts = getDefaultWorkspaceScripts();

    for (const name of ['test', 'test:coverage', 'test:watch']) {
      expect(scripts[name]).not.toContain('!');
    }
  });

  // Neither reaches the default gate, so a package holding only those tests is green under `nmr test`.
  it('leaves the tiers needing a running service out of every default selection', () => {
    const scripts = getDefaultWorkspaceScripts();

    for (const name of ['test', 'test:coverage', 'test:watch']) {
      expect(scripts[name]).not.toContain('localhost');
      expect(scripts[name]).not.toContain('remote');
    }
  });

  // A workspace-context upgrade scans the cwd package alone; the recursive sweep is the root registry's.
  // It reports no overrides either: `pnpm.overrides` is declared in the root `package.json` alone.
  it('upgrades the current package without recursing', () => {
    const scripts = getDefaultWorkspaceScripts();

    expect(scripts.upgrade).toBe('nmr-taze --include-locked');
    expect(scripts['report-overrides']).toBeUndefined();
  });
});

describe(getDefaultRootScripts, () => {
  it('includes all expected default root scripts', () => {
    const scripts = getDefaultRootScripts();

    expect(scripts.audit).toStrictEqual(['audit:prod', 'audit:dev']);
    expect(scripts.check).toStrictEqual(['typecheck', 'fmt:check', 'lint:check', 'test']);
    expect(scripts['fix:check']).toStrictEqual(['fmt:check', 'lint:check']);
    expect(scripts.ci).toStrictEqual(['build', 'check:strict', 'audit']);
    expect(scripts.clean).toBe('nmr-clean');
    // Identical to the workspace entries: the bin needs no `sh -c` wrapper to default its own selection.
    expect(scripts.fmt).toBe('nmr-fmt --write');
    expect(scripts['fmt:check']).toBe('nmr-fmt --check');
    expect(scripts['root:check']).toStrictEqual(['root:typecheck', 'fmt:check', 'root:lint:check', 'root:test']);
    expect(scripts['report-overrides']).toBe('nmr-report-overrides');
    expect(scripts['sync-agent-files']).toBe('nmr-sync-agent-files');
  });

  // `fmt` covers shell through the shared Prettier config, so a shell-specific command would be a
  // second way to format the same files -- and `fmt:sh` invoked a binary no CI runner installs.
  it('declares no shfmt-backed scripts', () => {
    const scripts = getDefaultRootScripts();

    expect(scripts).not.toHaveProperty('fmt:all');
    expect(scripts).not.toHaveProperty('fmt:sh');
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

  it('fans every test selection out to the root and to each package', () => {
    const scripts = getDefaultRootScripts();

    expect(scripts.test).toBe('nmr root:test && pnpm --recursive exec nmr test');
    expect(scripts['test:all']).toBe('nmr root:test:all && pnpm --recursive exec nmr test:all');
    expect(scripts['test:coverage']).toBe('nmr root:test && pnpm --recursive exec nmr test:coverage');
    expect(scripts['test:tool']).toBe('nmr root:test:tool && pnpm --recursive exec nmr test:tool');
    expect(scripts['test:unit']).toBe('nmr root:test:unit && pnpm --recursive exec nmr test:unit');
  });

  it('scopes each root-only test selection to the root config', () => {
    const scripts = getDefaultRootScripts();

    expect(scripts['root:test']).toBe('vitest --config ./vitest.root.config.ts --project unit --project tool');
    expect(scripts['root:test:all']).toBe('vitest --config ./vitest.root.config.ts');
    expect(scripts['root:test:tool']).toBe('vitest --config ./vitest.root.config.ts --project tool');
    expect(scripts['root:test:unit']).toBe('vitest --config ./vitest.root.config.ts --project unit');
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

  it('retires the integration selections from both registries', () => {
    expect(getDefaultRootScripts()).not.toHaveProperty('test:integration');
    expect(getDefaultRootScripts()).not.toHaveProperty('root:test:integration');
    expect(getDefaultWorkspaceScripts()).not.toHaveProperty('test:integration');
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
