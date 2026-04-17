export type ScriptValue = string | string[];
export type ScriptRegistry = Record<string, ScriptValue>;

/**
 * Workspace scripts shared by all test configurations.
 */
export const commonWorkspaceScripts: ScriptRegistry = {
  build: ['compile', 'generate-typings'],
  check: ['typecheck', 'fmt:check', 'lint:check', 'test'],
  'check:fixable': ['fmt:check', 'lint:check'],
  'check:strict': ['typecheck', 'fmt:check', 'lint:strict', 'test:coverage'],
  clean: 'pnpm exec rimraf dist/*',
  compile: 'tsx ../../config/build.ts',
  fix: ['lint', 'fmt'],
  fmt: 'prettier --list-different --write .',
  'fmt:check': 'prettier --check .',
  'generate-typings': 'tsc --project tsconfig.generate-typings.json',
  lint: 'eslint --fix .',
  'lint:check': 'eslint .',
  'lint:strict': 'strict-lint',
  typecheck: 'tsgo --noEmit',
  'view-coverage': 'open coverage/index.html',
};

/**
 * Test scripts for packages with a separate integration test config.
 */
export const integrationTestScripts: ScriptRegistry = {
  test: 'pnpm exec vitest --config=vitest.standalone.config.ts',
  'test:coverage': 'pnpm exec vitest --config=vitest.standalone.config.ts --coverage',
  'test:integration': 'pnpm exec vitest --config=vitest.integration.config.ts',
  'test:watch': 'pnpm exec vitest --config=vitest.standalone.config.ts --watch',
};

/**
 * Test scripts for packages using the default vitest config.
 */
export const standardTestScripts: ScriptRegistry = {
  test: 'pnpm exec vitest',
  'test:coverage': 'pnpm exec vitest --coverage',
  'test:watch': 'pnpm exec vitest --watch',
};

/**
 * Root-level monorepo scripts.
 */
export const rootScripts: ScriptRegistry = {
  audit: ['audit:prod', 'audit:dev'],
  'audit:dev': 'pnpm exec audit-deps --dev',
  'audit:prod': 'pnpm exec audit-deps --prod',
  build: 'pnpm --recursive exec nmr build',
  check: ['typecheck', 'fmt:check', 'lint:check', 'test'],
  'check:fixable': ['fmt:check', 'lint:check'],
  'check:strict': ['typecheck', 'fmt:check', 'lint:strict', 'test:coverage'],
  ci: ['build', 'check:strict', 'audit'],
  clean: 'pnpm --recursive exec nmr clean',
  fix: ['lint', 'fmt'],
  fmt: 'sh -c \'prettier --list-different --write "${@:-.}"\' --',
  'fmt:all': ['fmt', 'fmt:sh'],
  'fmt:check': 'sh -c \'prettier --check "${@:-.}"\' --',
  'fmt:sh': 'shfmt --write **/*.sh',
  lint: 'nmr root:lint && pnpm --recursive exec nmr lint',
  'lint:check': 'nmr root:lint:check && pnpm --recursive exec nmr lint:check',
  'lint:strict': 'nmr root:lint:strict && pnpm --recursive exec nmr lint:strict',
  outdated: 'pnpm outdated --compatible --recursive',
  'outdated:latest': 'pnpm outdated --recursive',
  'report-overrides': 'nmr-report-overrides',
  'root:check': ['root:typecheck', 'fmt:check', 'root:lint:check', 'root:test'],
  'root:lint': "eslint --fix --ignore-pattern 'packages/**' .",
  'root:lint:check': "eslint --ignore-pattern 'packages/**' .",
  'root:lint:strict': "strict-lint --ignore-pattern 'packages/**' .",
  'root:test': 'vitest --config ./vitest.root.config.ts',
  'root:typecheck': 'tsgo --noEmit',
  'sync-pnpm-version': 'nmr-sync-pnpm-version',
  test: 'nmr root:test && pnpm --recursive exec nmr test',
  'test:coverage': 'nmr root:test && pnpm --recursive exec nmr test:coverage',
  'test:watch': 'vitest --watch',
  typecheck: 'nmr root:typecheck && pnpm --recursive exec nmr typecheck',
  update: 'pnpm update --recursive',
  'update:latest': 'pnpm update --latest --recursive',
};
