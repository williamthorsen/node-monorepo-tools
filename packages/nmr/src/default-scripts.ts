export type ScriptValue = string | string[];
export type ScriptRegistry = Record<string, ScriptValue>;

/**
 * The tiers the default gate runs. Both need nothing beyond a checkout and an install, so they run wherever the
 * build already does; `localhost` and `remote` need something running and are left to an explicit selection.
 */
const GATE_PROJECTS = '--project unit --project tool';

/**
 * Workspace scripts, identical for every package: The test commands select Vitest projects, so a package
 * separates its tool-tier tests by naming them `*.tool.test.ts` rather than by carrying extra config files.
 *
 * Naming the tiers `test` runs makes a tier added later opt-in, not swept into the default gate on the release
 * that introduces it.
 */
export const workspaceScripts: ScriptRegistry = {
  build: ['compile'],
  check: ['typecheck', 'fmt:check', 'lint:check', 'test'],
  'check:strict': ['typecheck', 'fmt:check', 'lint:strict', 'test:coverage'],
  clean: 'nmr-clean',
  compile: 'nmr-compile',
  fix: ['lint', 'fmt'],
  'fix:check': ['fmt:check', 'lint:check'],
  fmt: 'nmr-fmt --write',
  'fmt:check': 'nmr-fmt --check',
  lint: 'eslint --fix .',
  'lint:check': 'eslint .',
  'lint:strict': 'strict-lint',
  test: `pnpm exec vitest ${GATE_PROJECTS}`,
  'test:all': 'pnpm exec vitest',
  'test:coverage': `pnpm exec vitest ${GATE_PROJECTS} --coverage`,
  'test:tool': 'pnpm exec vitest --project tool',
  'test:unit': 'pnpm exec vitest --project unit',
  'test:watch': `pnpm exec vitest ${GATE_PROJECTS} --watch`,
  typecheck: 'tsgo --noEmit',
  // Without `--include-locked`, nothing would be reported in a repo that pins exact version numbers.
  upgrade: 'nmr-taze --include-locked',
  'view-coverage': 'open coverage/index.html',
};

export const rootScripts: ScriptRegistry = {
  audit: ['audit:prod', 'audit:dev'],
  'audit:dev': 'pnpm exec v11y --dev',
  'audit:prod': 'pnpm exec v11y --prod',
  build: 'pnpm --recursive exec nmr build',
  check: ['typecheck', 'fmt:check', 'lint:check', 'test'],
  'check:strict': ['typecheck', 'fmt:check', 'lint:strict', 'test:coverage'],
  // Excludes the audit, which in CI has a workflow of its own.
  ci: ['build', 'check:strict'],
  clean: 'nmr-clean',
  fix: ['lint', 'fmt'],
  'fix:check': ['fmt:check', 'lint:check'],
  fmt: 'nmr-fmt --write',
  'fmt:check': 'nmr-fmt --check',
  lint: 'nmr root:lint && pnpm --recursive exec nmr lint',
  'lint:check': 'nmr root:lint:check && pnpm --recursive exec nmr lint:check',
  'lint:strict': 'nmr root:lint:strict && pnpm --recursive exec nmr lint:strict',
  prepush: ['ci', 'audit'],
  'report-overrides': 'nmr-report-overrides',
  'root:check': ['root:typecheck', 'fmt:check', 'root:lint:check', 'root:test'],
  'root:lint': "eslint --fix --ignore-pattern 'packages/**' .",
  'root:lint:check': "eslint --ignore-pattern 'packages/**' .",
  'root:lint:strict': "strict-lint --ignore-pattern 'packages/**' .",
  'root:test': `vitest --config ./vitest.root.config.ts ${GATE_PROJECTS}`,
  'root:test:all': 'vitest --config ./vitest.root.config.ts',
  'root:test:tool': 'vitest --config ./vitest.root.config.ts --project tool',
  'root:test:unit': 'vitest --config ./vitest.root.config.ts --project unit',
  'root:typecheck': 'tsgo --noEmit',
  'root:upgrade': 'nmr-taze --include-locked',
  test: 'nmr root:test && pnpm --recursive exec nmr test',
  'test:all': 'nmr root:test:all && pnpm --recursive exec nmr test:all',
  'test:coverage': 'nmr root:test && pnpm --recursive exec nmr test:coverage',
  'test:tool': 'nmr root:test:tool && pnpm --recursive exec nmr test:tool',
  'test:unit': 'nmr root:test:unit && pnpm --recursive exec nmr test:unit',
  // Bare `vitest` at the monorepo root resolves the root `vitest.config.ts`, covering the whole tree in one
  // process; a chain like the others would never advance past its first watcher.
  'test:watch': `vitest ${GATE_PROJECTS} --watch`,
  typecheck: 'nmr root:typecheck && pnpm --recursive exec nmr typecheck',
  // A string rather than a composite: Passthrough args attach to the chain's last command.
  upgrade: 'nmr-report-overrides && nmr-taze --include-locked --recursive',
};
