import type { ScriptRegistry } from './default-scripts.js';
import { commonWorkspaceScripts, integrationTestScripts, rootScripts, standardTestScripts } from './default-scripts.js';

export type { ScriptRegistry, ScriptValue } from './default-scripts.js';

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
