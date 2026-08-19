import { describe, expect, it } from 'vitest';

import type { ScriptRegistry } from '../resolve-scripts.ts';
import { buildRootRegistry, buildWorkspaceRegistry, expandScript } from '../resolver.ts';
import { renderChain } from '../steps.ts';

/** One default script's chain string, pinned as nmr shelled it before a command resolved to a step list. */
interface ChainRow {
  command: string;
  chain: string;
  /** Omitted where `-w` leaves the chain alone, which is every script the registry holds as a string. */
  workspaceRootChain?: string;
}

const WORKSPACE_CHAINS: readonly ChainRow[] = [
  {
    command: 'build',
    chain: 'nmr compile',
    workspaceRootChain: 'nmr -w compile',
  },
  {
    command: 'check',
    chain: 'nmr typecheck && nmr fmt:check && nmr lint:check && nmr test',
    workspaceRootChain: 'nmr -w typecheck && nmr -w fmt:check && nmr -w lint:check && nmr -w test',
  },
  {
    command: 'check:strict',
    chain: 'nmr typecheck && nmr fmt:check && nmr lint:strict && nmr test:coverage',
    workspaceRootChain: 'nmr -w typecheck && nmr -w fmt:check && nmr -w lint:strict && nmr -w test:coverage',
  },
  {
    command: 'clean',
    chain: 'nmr-clean',
  },
  {
    command: 'compile',
    chain: 'nmr-compile',
  },
  {
    command: 'fix',
    chain: 'nmr lint && nmr fmt',
    workspaceRootChain: 'nmr -w lint && nmr -w fmt',
  },
  {
    command: 'fix:check',
    chain: 'nmr fmt:check && nmr lint:check',
    workspaceRootChain: 'nmr -w fmt:check && nmr -w lint:check',
  },
  {
    command: 'fmt',
    chain: 'nmr-fmt --write',
  },
  {
    command: 'fmt:check',
    chain: 'nmr-fmt --check',
  },
  {
    command: 'lint',
    chain: 'eslint --fix .',
  },
  {
    command: 'lint:check',
    chain: 'eslint .',
  },
  {
    command: 'lint:strict',
    chain: 'strict-lint',
  },
  {
    command: 'report-catalog',
    chain: 'nmr-report-catalog',
  },
  {
    command: 'test',
    chain: 'pnpm exec vitest --project unit --project tool',
  },
  {
    command: 'test:all',
    chain: 'pnpm exec vitest',
  },
  {
    command: 'test:coverage',
    chain: 'pnpm exec vitest --project unit --project tool --coverage',
  },
  {
    command: 'test:tool',
    chain: 'pnpm exec vitest --project tool',
  },
  {
    command: 'test:unit',
    chain: 'pnpm exec vitest --project unit',
  },
  {
    command: 'test:watch',
    chain: 'pnpm exec vitest --project unit --project tool --watch',
  },
  {
    command: 'typecheck',
    chain: 'tsgo --noEmit',
  },
  {
    command: 'upgrade',
    chain: 'nmr-report-catalog && nmr-taze',
  },
  {
    command: 'view-coverage',
    chain: 'open coverage/index.html',
  },
];

const ROOT_CHAINS: readonly ChainRow[] = [
  {
    command: 'audit',
    chain: 'nmr audit:prod && nmr audit:dev',
    workspaceRootChain: 'nmr -w audit:prod && nmr -w audit:dev',
  },
  {
    command: 'audit:dev',
    chain: 'pnpm exec v11y --dev',
  },
  {
    command: 'audit:prod',
    chain: 'pnpm exec v11y --prod',
  },
  {
    command: 'build',
    chain: 'nmr -R build',
    workspaceRootChain: 'nmr -w -R build',
  },
  {
    command: 'check',
    chain: 'nmr typecheck && nmr fmt:check && nmr lint:check && nmr test',
    workspaceRootChain: 'nmr -w typecheck && nmr -w fmt:check && nmr -w lint:check && nmr -w test',
  },
  {
    command: 'check:strict',
    chain: 'nmr typecheck && nmr fmt:check && nmr lint:strict && nmr test:coverage',
    workspaceRootChain: 'nmr -w typecheck && nmr -w fmt:check && nmr -w lint:strict && nmr -w test:coverage',
  },
  {
    command: 'ci',
    chain: 'nmr build && nmr check:strict',
    workspaceRootChain: 'nmr -w build && nmr -w check:strict',
  },
  {
    command: 'clean',
    chain: 'nmr-clean',
  },
  {
    command: 'fix',
    chain: 'nmr lint && nmr fmt',
    workspaceRootChain: 'nmr -w lint && nmr -w fmt',
  },
  {
    command: 'fix:check',
    chain: 'nmr fmt:check && nmr lint:check',
    workspaceRootChain: 'nmr -w fmt:check && nmr -w lint:check',
  },
  {
    command: 'fmt',
    chain: 'nmr-fmt --write',
  },
  {
    command: 'fmt:check',
    chain: 'nmr-fmt --check',
  },
  {
    command: 'lint',
    chain: 'eslint --fix .',
  },
  {
    command: 'lint:check',
    chain: 'eslint .',
  },
  {
    command: 'lint:strict',
    chain: 'strict-lint',
  },
  {
    command: 'prepush',
    chain: 'nmr audit && nmr ci',
    workspaceRootChain: 'nmr -w audit && nmr -w ci',
  },
  {
    command: 'report-overrides',
    chain: 'nmr-report-overrides',
  },
  {
    command: 'root:check',
    chain: 'nmr root:typecheck && nmr fmt:check && nmr root:lint:check && nmr root:test',
    workspaceRootChain: 'nmr -w root:typecheck && nmr -w fmt:check && nmr -w root:lint:check && nmr -w root:test',
  },
  {
    command: 'root:lint',
    chain: "eslint --fix --ignore-pattern 'packages/**' .",
  },
  {
    command: 'root:lint:check',
    chain: "eslint --ignore-pattern 'packages/**' .",
  },
  {
    command: 'root:lint:strict',
    chain: "strict-lint --ignore-pattern 'packages/**' .",
  },
  {
    command: 'root:test',
    chain: 'vitest --config ./vitest.root.config.ts --project unit --project tool',
  },
  {
    command: 'root:test:all',
    chain: 'vitest --config ./vitest.root.config.ts',
  },
  {
    command: 'root:test:tool',
    chain: 'vitest --config ./vitest.root.config.ts --project tool',
  },
  {
    command: 'root:test:unit',
    chain: 'vitest --config ./vitest.root.config.ts --project unit',
  },
  {
    command: 'root:typecheck',
    chain: 'tsgo --noEmit',
  },
  {
    command: 'root:upgrade',
    chain: 'nmr-report-overrides && nmr-taze',
  },
  {
    command: 'test',
    chain: 'nmr root:test && nmr -R test',
    workspaceRootChain: 'nmr -w root:test && nmr -w -R test',
  },
  {
    command: 'test:all',
    chain: 'nmr root:test:all && nmr -R test:all',
    workspaceRootChain: 'nmr -w root:test:all && nmr -w -R test:all',
  },
  {
    command: 'test:coverage',
    chain: 'nmr root:test && nmr -R test:coverage',
    workspaceRootChain: 'nmr -w root:test && nmr -w -R test:coverage',
  },
  {
    command: 'test:tool',
    chain: 'nmr root:test:tool && nmr -R test:tool',
    workspaceRootChain: 'nmr -w root:test:tool && nmr -w -R test:tool',
  },
  {
    command: 'test:unit',
    chain: 'nmr root:test:unit && nmr -R test:unit',
    workspaceRootChain: 'nmr -w root:test:unit && nmr -w -R test:unit',
  },
  {
    command: 'test:watch',
    chain: 'vitest --project unit --project tool --watch',
  },
  {
    command: 'typecheck',
    chain: 'nmr root:typecheck && nmr -R typecheck',
    workspaceRootChain: 'nmr -w root:typecheck && nmr -w -R typecheck',
  },
  {
    command: 'upgrade',
    chain: 'nmr-report-overrides && nmr-taze --recursive',
  },
];

// The invariant #643's remaining children move execution against: no command's chain string moves except where a
// rewrite intends it. Enumerated rather than spot-checked, because the command that moves is the one nobody picked.
describe('default script chain rendering', () => {
  it.each([
    { registry: buildWorkspaceRegistry({}), rows: WORKSPACE_CHAINS, scope: 'workspace' },
    { registry: buildRootRegistry({}), rows: ROOT_CHAINS, scope: 'root' },
  ])('reproduces every pinned $scope chain', ({ registry, rows }) => {
    expect(renderRegistry(registry)).toStrictEqual(
      rows.map((row) => ({
        command: row.command,
        chain: row.chain,
        workspaceRootChain: row.workspaceRootChain ?? row.chain,
      })),
    );
  });
});

// region | Helpers

/** Renders every command in a registry, in both the scopes `-w` selects between. */
function renderRegistry(registry: ScriptRegistry): ChainRow[] {
  return Object.entries(registry).map(([command, script]) => ({
    command,
    chain: renderChain(expandScript(script, false)),
    workspaceRootChain: renderChain(expandScript(script, true)),
  }));
}

// endregion | Helpers
