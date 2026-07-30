export type ScriptValue = string | string[];
export type ScriptRegistry = Record<string, ScriptValue>;

/**
 * Workspace scripts, identical for every package: the test commands select Vitest projects, so a package
 * separates its integration tests by naming them `*.int.test.ts` rather than by carrying extra config files.
 *
 * `test` negates `integration` rather than naming the code-only projects, so a category added later joins the
 * default run instead of being silently dropped from it.
 */
export const workspaceScripts: ScriptRegistry = {
  build: ['compile'],
  check: ['typecheck', 'fmt:check', 'lint:check', 'test'],
  'check:strict': ['typecheck', 'fmt:check', 'lint:strict', 'test:coverage'],
  clean: 'nmr-clean',
  compile: 'nmr-compile',
  fix: ['lint', 'fmt'],
  'fix:check': ['fmt:check', 'lint:check'],
  fmt: 'prettier --list-different --write .',
  'fmt:check': 'prettier --check .',
  lint: 'eslint --fix .',
  'lint:check': 'eslint .',
  'lint:strict': 'strict-lint',
  test: "pnpm exec vitest --project '!integration'",
  'test:all': 'pnpm exec vitest',
  'test:coverage': "pnpm exec vitest --project '!integration' --coverage",
  'test:integration': 'pnpm exec vitest --project integration',
  'test:watch': "pnpm exec vitest --project '!integration' --watch",
  typecheck: 'tsgo --noEmit',
  // `--include-locked` is required rather than stylistic: a repo that pins exactly (pnpm's
  // `savePrefix: ''`) has no dependency taze considers unlocked, so without it nothing is reported.
  upgrade: 'nmr-taze --include-locked',
  'view-coverage': 'open coverage/index.html',
};

/**
 * Root-level monorepo scripts.
 */
export const rootScripts: ScriptRegistry = {
  audit: ['audit:prod', 'audit:dev'],
  'audit:dev': 'pnpm exec v11y --dev',
  'audit:prod': 'pnpm exec v11y --prod',
  build: 'pnpm --recursive exec nmr build',
  check: ['typecheck', 'fmt:check', 'lint:check', 'test'],
  'check:agent-files': 'nmr-sync-agent-files --check',
  'check:strict': ['typecheck', 'fmt:check', 'lint:strict', 'test:coverage', 'check:agent-files'],
  ci: ['build', 'check:strict', 'audit'],
  clean: 'nmr-clean',
  fix: ['lint', 'fmt'],
  'fix:check': ['fmt:check', 'lint:check'],
  fmt: 'sh -c \'prettier --list-different --write "${@:-.}"\' --',
  'fmt:all': ['fmt', 'fmt:sh'],
  'fmt:check': 'sh -c \'prettier --check "${@:-.}"\' --',
  'fmt:sh': 'shfmt --write **/*.sh',
  lint: 'nmr root:lint && pnpm --recursive exec nmr lint',
  'lint:check': 'nmr root:lint:check && pnpm --recursive exec nmr lint:check',
  'lint:strict': 'nmr root:lint:strict && pnpm --recursive exec nmr lint:strict',
  'report-overrides': 'nmr-report-overrides',
  'root:check': ['root:typecheck', 'fmt:check', 'root:lint:check', 'root:test'],
  'root:lint': "eslint --fix --ignore-pattern 'packages/**' .",
  'root:lint:check': "eslint --ignore-pattern 'packages/**' .",
  'root:lint:strict': "strict-lint --ignore-pattern 'packages/**' .",
  'root:test': "vitest --config ./vitest.root.config.ts --project '!integration'",
  'root:test:all': 'vitest --config ./vitest.root.config.ts',
  'root:test:integration': 'vitest --config ./vitest.root.config.ts --project integration',
  'root:typecheck': 'tsgo --noEmit',
  'root:upgrade': 'nmr-taze --include-locked',
  'sync-agent-files': 'nmr-sync-agent-files',
  test: 'nmr root:test && pnpm --recursive exec nmr test',
  'test:all': 'nmr root:test:all && pnpm --recursive exec nmr test:all',
  // Chains `root:test`, not a `root:test:coverage`: the root config reports no coverage of its own.
  'test:coverage': 'nmr root:test && pnpm --recursive exec nmr test:coverage',
  'test:integration': 'nmr root:test:integration && pnpm --recursive exec nmr test:integration',
  // Omitting `--config` is deliberate: bare `vitest` at the monorepo root resolves the root `vitest.config.ts`,
  // covering the whole tree in one process. A chain like the others would never advance past its first watcher.
  'test:watch': "vitest --project '!integration' --watch",
  typecheck: 'nmr root:typecheck && pnpm --recursive exec nmr typecheck',
  // A string rather than a composite because passthrough args attach to the chain's last command — as a
  // composite, `nmr upgrade major` would hand `major` to the override report instead of the upgrade tool.
  //
  // Overrides print first, as context for the report that follows: a pinned transitive dependency is why
  // an expected upgrade may be missing from it. taze handles pnpm workspaces natively, so this needs no
  // `pnpm --recursive` fan-out: one process covers the root and every package.
  upgrade: 'nmr-report-overrides && nmr-taze --include-locked --recursive',
};
