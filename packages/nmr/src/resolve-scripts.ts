import { buildRootScripts, type ScriptRegistry, workspaceScripts } from './default-scripts.ts';
import { resolveWorkspace } from './workspace.ts';
import { toWorkspacePackageGlobs } from './workspace-globs.ts';

export type { ScriptRegistry, ScriptValue, StepSpec } from './default-scripts.ts';

/**
 * Returns a shallow copy of the default workspace scripts, whose entries a caller may replace without changing the
 * defaults.
 */
export function getDefaultWorkspaceScripts(): ScriptRegistry {
  return { ...workspaceScripts };
}

/**
 * Returns the default root scripts for the monorepo at `monorepoRoot`, whose root-only lint commands exclude every
 * workspace package that its `pnpm-workspace.yaml` declares. A directory without that manifest yields commands
 * without exclusions rather than an error, so that a caller reading only the command names need not stand in a
 * workspace.
 */
export function getDefaultRootScripts(monorepoRoot: string): ScriptRegistry {
  const resolution = resolveWorkspace(monorepoRoot);
  const packageDirs = resolution.kind === 'packages' ? resolution.packageDirs : [];

  return buildRootScripts(toWorkspacePackageGlobs(monorepoRoot, packageDirs));
}
