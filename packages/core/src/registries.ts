export type ScriptValue = string | string[];
export type ScriptRegistry = Record<string, ScriptValue>;

/**
 * Default workspace scripts — available when running from inside a workspace package.
 */
function getDefaultWorkspaceScripts(useIntTests: boolean): ScriptRegistry {
  const commonScripts: ScriptRegistry = {
    build: ['compile', 'generate-typings'],
    check: ['typecheck', 'fmt:check', 'lint:check', 'test'],
    'check:strict': ['typecheck', 'fmt:check', 'lint:strict', 'test:coverage'],
    clean: 'pnpm exec rimraf dist/*',
    compile: 'tsx ../../config/build.ts',
    fmt: 'prettier --list-different --write .',
    'fmt:check': 'prettier --check .',
    'generate-typings': 'tsc --project tsconfig.generate-typings.json',
    lint: 'eslint --fix .',
    'lint:check': 'eslint .',
    'lint:strict': 'strict-lint',
    test: 'vitest',
    'test:coverage': 'vitest --coverage',
    'test:watch': 'vitest --watch',
    typecheck: 'tsgo --noEmit',
    'view-coverage': 'open coverage/index.html',
  };

  const integrationTestOverrides: ScriptRegistry = {
    test: 'pnpm exec vitest --config=vitest.standalone.config.ts',
    'test:coverage': 'pnpm exec vitest --config=vitest.standalone.config.ts --coverage',
    'test:integration': 'pnpm exec vitest --config=vitest.integration.config.ts',
    'test:watch': 'pnpm exec vitest --config=vitest.standalone.config.ts --watch',
  };

  const standardTestOverrides: ScriptRegistry = {
    test: 'pnpm exec vitest',
    'test:coverage': 'pnpm exec vitest --coverage',
    'test:watch': 'pnpm exec vitest --watch',
  };

  return {
    ...commonScripts,
    ...(useIntTests ? integrationTestOverrides : standardTestOverrides),
  };
}

/**
 * Default root scripts — available when running from the monorepo root.
 */
function getDefaultRootScripts(): ScriptRegistry {
  return {
    audit: ['audit:prod', 'audit:dev'],
    'audit:dev': 'pnpm dlx audit-ci@^6 --config .audit-ci/config.dev.json5',
    'audit:prod': 'pnpm dlx audit-ci@^6 --config .audit-ci/config.prod.json5',
    build: 'pnpm --recursive exec nmr build',
    check: ['typecheck', 'fmt:check', 'lint:check', 'test'],
    'check:strict': ['typecheck', 'fmt:check', 'lint:strict', 'test:coverage', 'audit'],
    ci: ['check:strict', 'build'],
    fmt: 'sh -c \'prettier --list-different --write "${@:-.}"\' --',
    'fmt:check': 'sh -c \'prettier --check "${@:-.}"\' --',
    lint: 'nmr root:lint && pnpm --recursive exec nmr lint',
    'lint:check': 'nmr root:lint:check && pnpm --recursive exec nmr lint:check',
    'lint:strict': 'nmr root:lint:strict && pnpm --recursive exec nmr lint:strict',
    outdated: 'pnpm outdated --compatible --recursive',
    'outdated:latest': 'pnpm outdated --recursive',
    'report-overrides': 'nmr-report-overrides',
    'root:lint': "eslint --fix --ignore-pattern 'packages/**' .",
    'root:lint:check': "eslint --ignore-pattern 'packages/**' .",
    'root:lint:strict':
      'echo "Strict linting for the workspace root cannot be enabled until a pattern is accepted as an argument. Falling back to normal linting." && nmr root:lint:check',
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
}

export { getDefaultRootScripts, getDefaultWorkspaceScripts };
