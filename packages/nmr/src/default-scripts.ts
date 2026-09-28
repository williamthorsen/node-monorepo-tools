/**
 * One element of a composite, paired with what it does with the invocation's trailing arguments. The bare
 * string form of an element is this spec with `shouldDeclineArguments` left at its default.
 */
export interface StepSpec {
  /** A command name, optionally preceded by nmr's own flags, as it would be typed after `nmr`. */
  run: string;
  /**
   * Set when the trailing arguments cannot narrow this step's work: It is a prerequisite against which the
   * narrowed steps run, or the tool that it invokes would be misled by them. A declining step runs unnarrowed.
   */
  shouldDeclineArguments?: boolean;
}

export type ScriptValue = string | ReadonlyArray<string | StepSpec>;
export type ScriptRegistry = Record<string, ScriptValue>;

/**
 * The tiers that the default gate runs. Both need nothing beyond a checkout and an install, so they run wherever the
 * build already does; `localhost` and `remote` need something running and are left to an explicit selection.
 */
const GATE_PROJECTS = '--project unit --project tool';

/**
 * The typecheck step of every composite that includes one. It declines the invocation's trailing arguments
 * because `tsgo --noEmit <file>` abandons the tsconfig and checks that file under default options, so an
 * argument meant to narrow the run would quietly change what the run means.
 *
 * Because in the root registry it names a composite whose own steps both decline, unmarking it there fails
 * the whole check on a forwarded argument rather than misleading the compiler.
 */
const TYPECHECK_STEP = { run: 'typecheck', shouldDeclineArguments: true } as const;

/** The root-scoped typecheck step, declining for the reason `TYPECHECK_STEP` gives: It invokes tsgo directly. */
const ROOT_TYPECHECK_STEP = { run: 'root:typecheck', shouldDeclineArguments: true } as const;

/**
 * Workspace scripts, identical for every package. A `test:<tier>` script runs the Vitest project of that tier, which
 * collects the test files that name it: `nmr test:tool` runs `my-file.tool.test.ts`. The `unit` project also
 * collects every file that does not name any other tier.
 */
export const workspaceScripts: ScriptRegistry = {
  build: ['compile'],
  check: [TYPECHECK_STEP, 'fmt:check', 'lint:check', 'test'],
  'check:strict': [TYPECHECK_STEP, 'fmt:check', 'lint:strict', 'test'],
  clean: 'nmr-clean',
  compile: 'nmr-compile',
  fix: ['lint', 'fmt'],
  'fix:check': ['fmt:check', 'lint:check'],
  fmt: 'nmr-fmt --write',
  'fmt:check': 'nmr-fmt --check',
  lint: 'eslint --fix .',
  'lint:check': 'eslint .',
  'lint:strict': 'strict-lint',
  'report-catalog': 'nmr-report-catalog',
  test: `pnpm exec vitest ${GATE_PROJECTS}`,
  'test:all': 'pnpm exec vitest',
  'test:coverage': `pnpm exec vitest ${GATE_PROJECTS} --coverage`,
  'test:tool': 'pnpm exec vitest --project tool',
  'test:unit': 'pnpm exec vitest --project unit',
  'test:watch': `pnpm exec vitest ${GATE_PROJECTS} --watch`,
  typecheck: 'tsgo --noEmit',
  // The command is a string because neither half names an nmr command: Both are binaries.
  upgrade: 'nmr-report-catalog && nmr-taze',
  'view-coverage': 'open coverage/index.html',
};

export const rootScripts: ScriptRegistry = {
  audit: ['audit:prod', 'audit:dev'],
  'audit:dev': 'pnpm exec v11y --dev',
  'audit:prod': 'pnpm exec v11y --prod',
  build: ['-R build'],
  check: [TYPECHECK_STEP, 'fmt:check', 'lint:check', 'test'],
  'check:strict': [TYPECHECK_STEP, 'fmt:check', 'lint:strict', 'test'],
  // Excludes the audit, which in CI has a workflow of its own. The narrowed check runs against the build, so
  // the build declines the arguments rather than being narrowed by them.
  ci: [{ run: 'build', shouldDeclineArguments: true }, 'check:strict'],
  clean: 'nmr-clean',
  fix: ['lint', 'fmt'],
  'fix:check': ['fmt:check', 'lint:check'],
  fmt: 'nmr-fmt --write',
  'fmt:check': 'nmr-fmt --check',
  lint: 'eslint --fix .',
  'lint:check': 'eslint .',
  'lint:strict': 'strict-lint',
  // The audit takes seconds and `ci` takes minutes, so the cheap gate fails first. The audit reads the
  // dependency tree, and an argument narrowing the code under test does not say anything about that tree.
  prepush: [{ run: 'audit', shouldDeclineArguments: true }, 'ci'],
  'report-overrides': 'nmr-report-overrides',
  'root:check': [ROOT_TYPECHECK_STEP, 'fmt:check', 'root:lint:check', 'root:test'],
  'root:lint': "eslint --fix --ignore-pattern 'packages/**' .",
  'root:lint:check': "eslint --ignore-pattern 'packages/**' .",
  'root:lint:strict': "strict-lint --ignore-pattern 'packages/**' .",
  'root:test': `vitest --config ./vitest.root.config.ts ${GATE_PROJECTS}`,
  'root:test:all': 'vitest --config ./vitest.root.config.ts',
  'root:test:tool': 'vitest --config ./vitest.root.config.ts --project tool',
  'root:test:unit': 'vitest --config ./vitest.root.config.ts --project unit',
  'root:typecheck': 'tsgo --noEmit',
  // Includes the override report for the same reason `upgrade` does: Both end in the tool that rewrites a
  // `pnpm.overrides` block, so both need the reporter's rejection ahead of them.
  'root:upgrade': 'nmr-report-overrides && nmr-taze',
  test: ['root:test', '-R test'],
  'test:all': ['root:test:all', '-R test:all'],
  'test:coverage': ['root:test', '-R test:coverage'],
  'test:tool': ['root:test:tool', '-R test:tool'],
  'test:unit': ['root:test:unit', '-R test:unit'],
  'test:watch': `vitest ${GATE_PROJECTS} --watch`,
  // Neither step is narrowable, so `nmr typecheck <file>` is rejected rather than checking that file under
  // default options at the root and searching for it in every package.
  typecheck: [ROOT_TYPECHECK_STEP, { run: '-R typecheck', shouldDeclineArguments: true }],
  // The command is a string because neither half names an nmr command: Both are binaries, and a composite
  // element can name only a command.
  upgrade: 'nmr-report-overrides && nmr-taze --recursive',
};
