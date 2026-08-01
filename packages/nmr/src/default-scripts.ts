export type ScriptValue = string | string[];
export type ScriptRegistry = Record<string, ScriptValue>;

/**
 * The tiers the default gate runs. Both need nothing beyond a checkout and an install, so they run wherever the
 * build already does; `localhost` and `remote` need something running and are left to an explicit selection.
 *
 * Written once and interpolated, so the six commands sharing this selection cannot drift apart.
 */
const GATE_PROJECTS = '--project unit --project tool';

/**
 * Workspace scripts, identical for every package: The test commands select Vitest projects, so a package
 * separates its tool-tier tests by naming them `*.tool.test.ts` rather than by carrying extra config files.
 *
 * `test` names the tiers it runs rather than negating the ones it skips, so a tier added later is opt-in rather
 * than swept into the default gate on the release that introduces it.
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
  // Identical to the workspace entries: the bin scopes its own selection to the working directory, so
  // neither registry needs the `sh -c '… "${@:-.}"' --` wrapper that gave the root form a default path.
  fmt: 'nmr-fmt --write',
  'fmt:check': 'nmr-fmt --check',
  lint: 'nmr root:lint && pnpm --recursive exec nmr lint',
  'lint:check': 'nmr root:lint:check && pnpm --recursive exec nmr lint:check',
  'lint:strict': 'nmr root:lint:strict && pnpm --recursive exec nmr lint:strict',
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
  'sync-agent-files': 'nmr-sync-agent-files',
  test: 'nmr root:test && pnpm --recursive exec nmr test',
  'test:all': 'nmr root:test:all && pnpm --recursive exec nmr test:all',
  // Chains `root:test`, not a `root:test:coverage`: the root config reports no coverage of its own.
  'test:coverage': 'nmr root:test && pnpm --recursive exec nmr test:coverage',
  'test:tool': 'nmr root:test:tool && pnpm --recursive exec nmr test:tool',
  'test:unit': 'nmr root:test:unit && pnpm --recursive exec nmr test:unit',
  // Omitting `--config` is deliberate: bare `vitest` at the monorepo root resolves the root `vitest.config.ts`,
  // covering the whole tree in one process. A chain like the others would never advance past its first watcher.
  'test:watch': `vitest ${GATE_PROJECTS} --watch`,
  typecheck: 'nmr root:typecheck && pnpm --recursive exec nmr typecheck',
  // A string rather than a composite because passthrough args attach to the chain's last command — as a
  // composite, `nmr upgrade major` would hand `major` to the override report instead of the upgrade tool.
  //
  // Overrides print first, as context for the report that follows: a pinned transitive dependency is why
  // an expected upgrade may be missing from it. taze handles pnpm workspaces natively, so this needs no
  // `pnpm --recursive` fan-out: one process covers the root and every package.
  upgrade: 'nmr-report-overrides && nmr-taze --include-locked --recursive',
};
