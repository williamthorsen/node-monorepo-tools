import type { ScriptRegistry } from './default-scripts.ts';
import { commonWorkspaceScripts, integrationTestScripts, rootScripts, standardTestScripts } from './default-scripts.ts';

export type { ScriptRegistry, ScriptValue } from './default-scripts.ts';

/**
 * Return the default workspace scripts, selecting the appropriate test variant.
 */
export function getDefaultWorkspaceScripts(useIntTests: boolean): ScriptRegistry {
  return {
    ...commonWorkspaceScripts,
    ...(useIntTests ? integrationTestScripts : standardTestScripts),
  };
}

/**
 * Return the default root scripts.
 */
export function getDefaultRootScripts(): ScriptRegistry {
  return { ...rootScripts };
}
