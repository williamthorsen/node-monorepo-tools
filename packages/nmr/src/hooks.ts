import type { ScriptRegistry } from './resolve-scripts.ts';
import { findChainedSelfReference, resolveScript } from './resolver.ts';
import { composeNmrStep, renderChain, type Step } from './steps.ts';

/**
 * Returns true when a hook resolves to a chain other than the skip values `""` and `":"`, or when its
 * `package.json` entry chains steps onto a re-invocation of the hook.
 */
export function hasRunnableHook(
  hookName: string,
  registry: ScriptRegistry,
  anchorDir: string,
  isWorkspaceRoot: boolean,
): boolean {
  // A rejected entry resolves to nothing whenever the registry does not define the hook, and dropping the hook
  // would drop the report with it. Wrapping it puts the rejection in front of the hook's own process.
  if (findChainedSelfReference(anchorDir, hookName) !== undefined) {
    return true;
  }

  const resolvedScript = resolveScript(hookName, registry, anchorDir, isWorkspaceRoot);
  if (!resolvedScript) return false;

  const chain = renderChain(resolvedScript.steps);
  return chain !== '' && chain !== ':';
}

/**
 * Wraps a resolved main command's steps with `nmr <command>:pre` and `nmr <command>:post`
 * steps when the corresponding hooks resolve to non-skip values.
 *
 * Omits a hook that `hasRunnableHook` rejects, so a missing or skipped hook does not add a step or any output.
 *
 * `-w` is propagated to hook subprocesses so that each hook selects the root registry
 * on its own, independent of where the child derives its context from.
 */
export function wrapWithHooks(
  command: string,
  mainSteps: readonly Step[],
  registry: ScriptRegistry,
  anchorDir: string,
  isWorkspaceRoot: boolean,
): readonly Step[] {
  const steps: Step[] = [];

  if (hasRunnableHook(`${command}:pre`, registry, anchorDir, isWorkspaceRoot)) {
    steps.push(composeNmrStep(`${command}:pre`, isWorkspaceRoot));
  }
  steps.push(...mainSteps);
  if (hasRunnableHook(`${command}:post`, registry, anchorDir, isWorkspaceRoot)) {
    steps.push(composeNmrStep(`${command}:post`, isWorkspaceRoot));
  }

  return steps;
}
