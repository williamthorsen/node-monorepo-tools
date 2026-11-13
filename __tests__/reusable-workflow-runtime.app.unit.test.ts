import { describe, expect, it } from 'vitest';

import { isRecord } from '../packages/nmr-core/src/portable/isRecord.ts';
import {
  listJobs,
  listReusableWorkflows,
  listSteps,
  readJob,
  readReusableWorkflow,
  type WorkflowStep,
} from '../test-utils/workflows.ts';

const PNPM_WORKFLOWS = ['audit', 'create-github-release', 'publish', 'release'];

/** The action whose step installs Node.js in each workflow that installs pnpm. */
const NODE_SETUP_ACTIONS: Record<string, string> = {
  audit: 'pnpm/setup',
  'create-github-release': 'pnpm/setup',
  publish: 'pnpm/setup',
  release: 'actions/setup-node',
};

/** Workflows that take a `node-version` input. */
const NODE_VERSION_INPUT_WORKFLOWS = ['create-github-release', 'publish'];

/** Workflows whose Node.js runtime comes from `pnpm/setup`, which does not install `npm`, `npx`, or `corepack`. */
const PNPM_RUNTIME_WORKFLOWS = ['audit', 'create-github-release', 'publish'];

/** Matches a `corepack` invocation at the start of a command or after a shell separator. */
const COREPACK_INVOCATION_PATTERN = /(?:^|[\s;&|(])corepack\s/m;

/** Matches a `node`, `npm`, `npx`, `corepack`, or `pnpm` invocation at the start of a command or after a shell separator. */
const NODE_TOOL_INVOCATION_PATTERN = /(?:^|[\s;&|(])(?:node|npm|npx|corepack|pnpm)\s/m;

/** Matches an `npm` or `npx` invocation at the start of a command or after a shell separator. */
const NPM_INVOCATION_PATTERN = /(?:^|[\s;&|(])(?:npm|npx)\s/m;

describe('every reusable workflow that installs pnpm uses pnpm/setup', () => {
  it.each(PNPM_WORKFLOWS)('%s.reusable.yaml', (name) => {
    const steps = listWorkflowSteps(readReusableWorkflow(name));

    expect(
      findSteps(steps, 'pnpm/setup'),
      'set pnpm up with `pnpm/setup`, which supersedes `pnpm/action-setup`',
    ).not.toHaveLength(0);
    expect(findSteps(steps, 'pnpm/action-setup'), '`pnpm/action-setup` is superseded').toHaveLength(0);
  });
});

/**
 * Guards the workflows that take their runtime from `pnpm/setup` against an `npm` or `npx` invocation.
 *
 * `pnpm/setup` omits `npm`, `npx`, and `corepack` from the Node.js archive that it installs, so either
 * name falls through to the runner image's copy, at a version that the workflows here do not control.
 * Only `audit.reusable.yaml` is exercised by a pull request; an invocation in the other two would
 * otherwise go undetected until release time.
 */
describe('workflows whose runtime comes from pnpm/setup invoke neither npm nor npx', () => {
  it.each(PNPM_RUNTIME_WORKFLOWS)('%s.reusable.yaml', (name) => {
    const steps = listWorkflowSteps(readReusableWorkflow(name));

    expect(
      findSteps(steps, 'actions/setup-node'),
      'the single `pnpm/setup` step supplies both pnpm and the runtime',
    ).toHaveLength(0);
    expect(
      collectRunCommands(steps),
      '`pnpm/setup` does not install `npm` or `npx`, so either falls through to the runner image at an uncontrolled version; reach a package binary with `pnpm exec` and an uninstalled one with `pnpm dlx`',
    ).not.toMatch(NPM_INVOCATION_PATTERN);
  });
});

/**
 * Guards every reusable workflow against a `corepack` invocation.
 *
 * A call to Corepack fails outright on a runner Node that does not bundle it, because Node 25
 * removed Corepack from the distribution. `COREPACK_ENABLE_STRICT` in `env:` is unaffected, because
 * an environment variable does not need Corepack to exist.
 */
describe('reusable workflows do not invoke corepack', () => {
  it.each(listReusableWorkflows())('%s.reusable.yaml', (name) => {
    expect(
      collectRunCommands(listWorkflowSteps(readReusableWorkflow(name))),
      'Node 25 and later do not bundle `corepack`; neutralize Corepack with the `COREPACK_ENABLE_STRICT` environment variable instead',
    ).not.toMatch(COREPACK_INVOCATION_PATTERN);
  });
});

describe('reusable workflows install the Node.js version that the caller pins', () => {
  it.each(Object.entries(NODE_SETUP_ACTIONS))('%s.reusable.yaml reads .tool-versions through %s', (name, action) => {
    const steps = findSteps(listWorkflowSteps(readReusableWorkflow(name)), action);

    expect(steps).not.toHaveLength(0);
    for (const step of steps) {
      expect(step.with?.['node-version-file'], 'a caller that moves its pin would otherwise run another Node.js').toBe(
        '.tool-versions',
      );
      expect(step.with?.['node-version'], 'a literal version outranks the file').toBeUndefined();
      expect(readRuntime(step), 'a version in `runtime` outranks the file').not.toMatch(/^node@/);
    }
  });

  it.each(NODE_VERSION_INPUT_WORKFLOWS)(
    '%s.reusable.yaml overrides .tool-versions only with a set node-version input',
    (name) => {
      const workflow = readReusableWorkflow(name);
      const input = readWorkflowCallInputs(workflow)['node-version'];

      expect(isRecord(input) ? input['default'] : undefined, 'a default would outrank `.tool-versions`').toBe('');
      const setupSteps = findSteps(listWorkflowSteps(workflow), 'pnpm/setup');
      for (const step of setupSteps) {
        expect(readRuntime(step)).toContain('inputs.node-version');
      }
    },
  );
});

describe('release.reusable.yaml takes its runtime from actions/setup-node', () => {
  const releaseSteps = listSteps(readJob(readReusableWorkflow('release'), 'release'));

  it('retains the step that supplies npm and npx', () => {
    expect(
      findSteps(releaseSteps, 'actions/setup-node'),
      '`release-kit prepare` spawns `npx prettier`, and the consumer path runs `npm install --global`',
    ).not.toHaveLength(0);
  });

  it('keeps pnpm/setup from installing Node.js from a version file', () => {
    expect(
      String(findSteps(releaseSteps, 'pnpm/setup')[0]?.with?.['node-version-file']),
      'without `node-version-file: false`, `pnpm/setup` installs the Node.js version in `.tool-versions` ahead of `actions/setup-node`',
    ).toBe('false');
  });

  it('runs no Node.js tool before actions/setup-node installs one', () => {
    expect(
      collectRunCommands(listStepsBefore(releaseSteps, (step) => isActionStep(step, 'actions/setup-node'))),
      'a self-hosted runner image does not include Node.js, so a `node`, `npm`, `npx`, `corepack`, or `pnpm` call ahead of `actions/setup-node` fails the job',
    ).not.toMatch(NODE_TOOL_INVOCATION_PATTERN);
  });

  it('keeps actions/setup-node from acting on the packageManager field', () => {
    expect(
      String(findSteps(releaseSteps, 'actions/setup-node')[0]?.with?.['package-manager-cache']),
      'without `package-manager-cache: false`, `actions/setup-node` turns on caching when `packageManager` names npm',
    ).toBe('false');
  });

  it('leaves package.json unmodified before release preparation', () => {
    expect(
      collectRunCommands(listStepsBefore(releaseSteps, (step) => step.name === 'Run release preparation')),
      '`release-kit commit` stages every change, so a rewritten `package.json` lands in the release commit',
    ).not.toMatch(/package\.json/);
  });
});

// region | Helpers

/**
 * Collects the shell text of the steps' `run:` scripts, with comment lines dropped.
 *
 * A `run:` value is what a step executes; `description:` and `name:` values elsewhere in a workflow
 * mention npm without invoking it.
 */
function collectRunCommands(steps: WorkflowStep[]): string {
  return steps
    .flatMap((step) => step.run?.split('\n') ?? [])
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/** Lists the steps that use the action, at any version. */
function findSteps(steps: WorkflowStep[], action: string): WorkflowStep[] {
  return steps.filter((step) => isActionStep(step, action));
}

/** Reports whether the step uses the action, at any version. */
function isActionStep(step: WorkflowStep, action: string): boolean {
  return step.uses?.startsWith(`${action}@`) ?? false;
}

/** Returns the steps that precede the first step matching the predicate, and throws when no step matches. */
function listStepsBefore(steps: WorkflowStep[], isMarker: (step: WorkflowStep) => boolean): WorkflowStep[] {
  const markerIndex = steps.findIndex(isMarker);
  if (markerIndex === -1) {
    throw new Error('No step matches the marker');
  }

  return steps.slice(0, markerIndex);
}

/** Lists the steps of every job in the workflow. */
function listWorkflowSteps(workflow: Record<string, unknown>): WorkflowStep[] {
  return listJobs(workflow).flatMap(listSteps);
}

/** Returns the step's `runtime` input, or an empty string when it is not a string. */
function readRuntime(step: WorkflowStep): string {
  const runtime = step.with?.['runtime'];
  return typeof runtime === 'string' ? runtime : '';
}

/** Returns the `workflow_call` inputs that the workflow declares. */
function readWorkflowCallInputs(workflow: Record<string, unknown>): Record<string, unknown> {
  const on = workflow['on'];
  const call = isRecord(on) ? on['workflow_call'] : undefined;
  const inputs = isRecord(call) ? call['inputs'] : undefined;
  return isRecord(inputs) ? inputs : {};
}

// endregion | Helpers
