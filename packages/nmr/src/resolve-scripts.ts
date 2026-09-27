import { rootScripts, type ScriptRegistry, workspaceScripts } from './default-scripts.ts';

export type { ScriptRegistry, ScriptValue, StepSpec } from './default-scripts.ts';

/**
 * Returns a shallow copy of the default workspace scripts, whose entries a caller may replace without changing the
 * defaults.
 */
export function getDefaultWorkspaceScripts(): ScriptRegistry {
  return { ...workspaceScripts };
}

/**
 * Returns a shallow copy of the default root scripts, whose entries a caller may replace without changing the
 * defaults.
 */
export function getDefaultRootScripts(): ScriptRegistry {
  return { ...rootScripts };
}
