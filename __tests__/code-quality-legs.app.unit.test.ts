import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getDefaultRootScripts, type ScriptRegistry, type StepSpec } from '@williamthorsen/nmr/scripts';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import nmrConfig from '../.config/nmr.config.ts';

const monorepoRoot = join(import.meta.dirname, '..');
const workflowPath = join(monorepoRoot, '.github', 'workflows', 'code-quality.yaml');

/**
 * Guards the code-quality workflow's legs against the root `ci` composite. A composite split into legs does not fire
 * its `:post` hook, so a step or hook added to `ci`'s composites would otherwise go unrun in CI without any failure.
 */
describe('code-quality.yaml legs', () => {
  const legs = readLegs(readFileSync(workflowPath, 'utf8'));

  it('runs each leg as the nmr command that names it', () => {
    for (const leg of legs) {
      expect(leg.command).toBe(`pnpm exec nmr ${leg.name}`);
    }
  });

  it('covers the expansion of `ci`, in order', () => {
    const registry: ScriptRegistry = { ...getDefaultRootScripts(monorepoRoot), ...nmrConfig.rootScripts };

    const legNames = legs.map((leg) => leg.name);

    expect(legNames).toStrictEqual(expandSteps(['ci'], registry, new Set(legNames)));
  });
});

// region | Helpers

interface Leg {
  name: string;
  command: string;
}

/**
 * Keeps each step that a leg runs, and replaces any other composite with its `:pre` hook, its steps, and its `:post`
 * hook, as nmr's hook wrapping orders them, recursively. A step that is neither stays as it is, so that the
 * comparison reports it as missing; a hook declared as a string script is such a step.
 */
function expandSteps(steps: string[], registry: ScriptRegistry, legNames: ReadonlySet<string>): string[] {
  return steps.flatMap((step) => {
    const value = registry[step];
    if (legNames.has(step) || !Array.isArray(value)) return [step];
    const expanded = [
      ...toHookNames(step, 'pre', registry),
      ...toStepNames(value),
      ...toHookNames(step, 'post', registry),
    ];
    return expandSteps(expanded, registry, legNames);
  });
}

/** Reports whether a value has the `{ name, command }` shape of a `check-commands` entry. */
function isLeg(value: unknown): value is Leg {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string' &&
    'command' in value &&
    typeof value.command === 'string'
  );
}

/** Reads the `check-commands` legs that the workflow passes to the reusable code-quality workflow. */
function readLegs(content: string): Leg[] {
  const workflow: unknown = parse(content);
  const checkCommands =
    typeof workflow === 'object' && workflow !== null && 'jobs' in workflow
      ? readPath(workflow.jobs, ['code-quality', 'with', 'check-commands'])
      : undefined;
  if (typeof checkCommands !== 'string') throw new Error('code-quality.yaml does not declare check-commands');

  const legs: unknown = JSON.parse(checkCommands);
  if (!Array.isArray(legs) || !legs.every(isLeg)) throw new Error('check-commands is not a list of { name, command }');
  return legs;
}

/** Follows a key path through nested objects, returning `undefined` when a segment is missing. */
function readPath(value: unknown, keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = Object.getOwnPropertyDescriptor(current, key)?.value;
  }
  return current;
}

/** Names a command's `:pre` or `:post` hook when the registry declares one. */
function toHookNames(command: string, phase: 'post' | 'pre', registry: ScriptRegistry): string[] {
  const hook = `${command}:${phase}`;
  return Object.hasOwn(registry, hook) ? [hook] : [];
}

/** Names the commands of a composite's steps; a string script or a missing entry yields none. */
function toStepNames(value: ScriptRegistry[string] | undefined): string[] {
  if (value === undefined || typeof value === 'string') return [];
  return value.map((step: string | StepSpec) => (typeof step === 'string' ? step : step.run));
}

// endregion | Helpers
