import { findClosestName } from './helpers/findClosestName.ts';
import { isHookName } from './helpers/hook-name.ts';
import { buildRootRegistry, buildWorkspaceRegistry, readPackageJsonScripts } from './resolver.ts';
import type { NmrConfig } from './types.ts';
import { UserError } from './UserError.ts';
import { getWorkspacePackageDirs, isMonorepoRoot } from './workspace.ts';

/**
 * Rejects a `checkCache` name that does not resolve to any command. Both fields are read by name alone, so a
 * misspelt entry is inert: The command that it meant to name goes on running, indistinguishable from one that
 * cannot be cached at all.
 *
 * Because the test is resolvability rather than membership of the cacheable set, an `excludeCommands` entry
 * written against a name that a later release moves out of the defaults remains valid.
 *
 * Reads nothing while every name resolves in the merged registries, and reads a package's own `scripts` only
 * once a name is missing from them: Those are a resolution tier of their own; a name declared only there is
 * valid.
 *
 * Does nothing outside a monorepo root, where `checkCache` is a key that this tier does not honor. `assertTierKeys`
 * reports that, and of the two messages it is the one that names the real mistake.
 */
export function assertResolvableCheckCacheCommands(config: NmrConfig, configPath: string, baseDir: string): void {
  const { checkCache } = config;
  if (checkCache === undefined || !isMonorepoRoot(baseDir)) {
    return;
  }

  const fields = ['excludeCommands', 'extraCommands'] as const;
  const entries = fields.flatMap((field) => (checkCache[field] ?? []).map((command) => ({ command, field })));

  const hook = entries.find(({ command }) => isHookName(command));
  if (hook !== undefined) {
    throw new UserError(
      `Invalid nmr config at ${configPath}: \`checkCache.${hook.field}\` names the hook \`${hook.command}\`, ` +
        'which is never gated on its own: It runs as part of the chain of the command that it wraps.',
    );
  }

  const registeredNames = new Set([
    ...Object.keys(buildRootRegistry(config, baseDir)),
    ...Object.keys(buildWorkspaceRegistry(config)),
  ]);
  const missingEntries = entries.filter(({ command }) => !registeredNames.has(command));
  if (missingEntries.length === 0) {
    return;
  }

  const declaredNames = readDeclaredScriptNames(baseDir);
  const unresolvableEntry = missingEntries.find(({ command }) => !declaredNames.has(command));
  if (unresolvableEntry === undefined) {
    return;
  }

  const closestName = findClosestName(unresolvableEntry.command, [...registeredNames, ...declaredNames]);
  throw new UserError(
    `Invalid nmr config at ${configPath}: \`checkCache.${unresolvableEntry.field}\` does not name any command: ` +
      `\`${unresolvableEntry.command}\`.${closestName === undefined ? '' : ` Did you mean \`${closestName}\`?`}`,
  );
}

// region | Helpers

/**
 * Collects the command names declared by the workspace's `package.json` files, the resolution tier that the
 * merged registries do not describe.
 *
 * A manifest whose content this cannot read does not contribute any names, and a readable sibling still
 * contributes its own. The sweep runs for the config's sake rather than the package's, so a manifest that is
 * malformed elsewhere in the workspace must not fail every command run anywhere in it; the package's own runs
 * report it, in a message that names something that the reader was asking about.
 *
 * A package manifest that cannot be read at all is a different matter and propagates. An unreadable path is a
 * fault in the checkout rather than a statement about the manifest's content, and one that nothing else here
 * would report.
 */
function readDeclaredScriptNames(monorepoRoot: string): Set<string> {
  let packageDirs: string[];
  try {
    packageDirs = getWorkspacePackageDirs(monorepoRoot);
  } catch {
    packageDirs = [];
  }

  const names = new Set<string>();
  const dirs = [monorepoRoot, ...packageDirs];
  for (const dir of dirs) {
    const scripts = readPackageScripts(dir);
    for (const name of Object.keys(scripts)) {
      names.add(name);
    }
  }

  return names;
}

/** Reads one package's declared scripts, treating a manifest whose content does not parse as declaring none. */
function readPackageScripts(packageDir: string): Record<string, string> {
  try {
    return readPackageJsonScripts(packageDir) ?? {};
  } catch (error: unknown) {
    if (error instanceof UserError) {
      return {};
    }
    throw error;
  }
}

// endregion | Helpers
