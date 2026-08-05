export type ScriptValue = string | string[];
export type ScriptRegistry = Record<string, ScriptValue>;

/**
 * The tiers the default gate runs. Both need nothing beyond a checkout and an install, so they run wherever the
 * build already does; `localhost` and `remote` need something running and are left to an explicit selection.
 */
const GATE_PROJECTS = '--project unit --project tool';

/**
 * Workspace scripts, identical for every package.
 * Four Vitest projects are recognized: `tool`, `localhost`, `remote`, and `unit`. The latter is also a catch-all.
 * Name a test file with the matching infix to associate it with a project.
 * Example: `nmr test:tool` runs every file carrying the `tool` infix, such as `my-file.tool.test.ts`.
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
  lint: 'eslint --fix .',
  'lint:check': 'eslint .',
  'lint:strict': 'strict-lint',
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
  'test:watch': `vitest ${GATE_PROJECTS} --watch`,
  typecheck: 'nmr root:typecheck && pnpm --recursive exec nmr typecheck',
  // The command must be a string rather than a composite: Passthrough args attach to the chain's last command.
  upgrade: 'nmr-report-overrides && nmr-taze --include-locked --recursive',
};
