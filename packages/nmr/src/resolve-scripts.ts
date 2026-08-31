import { rootScripts, type ScriptRegistry, workspaceScripts } from './default-scripts.ts';

export type { ScriptRegistry, ScriptValue, StepSpec } from './default-scripts.ts';

/**
 * Return the default workspace scripts.
 *
 * A function rather than the exported table itself: callers merge overrides into the result, and `generateHelp`
 * rewrites entries in place, so each caller needs a copy the module does not share.
 */
export function getDefaultWorkspaceScripts(): ScriptRegistry {
  return { ...workspaceScripts };
}

/**
 * Return the default root scripts.
 */
export function getDefaultRootScripts(): ScriptRegistry {
  return { ...rootScripts };
}
