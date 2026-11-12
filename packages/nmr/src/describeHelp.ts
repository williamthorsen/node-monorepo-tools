import { DELEGATE_ENV_VAR } from './delegation/remote-run.ts';
import { isHookName } from './helpers/isHookName.ts';
import { OUTPUT_STYLE_ENV_VAR } from './output-style.ts';
import type { ScriptRegistry } from './resolve-scripts.ts';
import {
  buildRootRegistry,
  buildWorkspaceRegistry,
  describeScript,
  isSelfReferential,
  readPackageJsonScripts,
} from './resolver.ts';
import type { NmrConfig } from './types.ts';

// A package manager runs these during install, pack, publish, and version, so they are not commands to invoke.
const LIFECYCLE_SCRIPT_NAMES: ReadonlySet<string> = new Set([
  'dependencies',
  'install',
  'pnpm:devPreinstall',
  'postinstall',
  'postpack',
  'postprepare',
  'postpublish',
  'postuninstall',
  'postversion',
  'preinstall',
  'prepack',
  'prepare',
  'preprepare',
  'prepublish',
  'prepublishOnly',
  'preuninstall',
  'preversion',
  'publish',
  'uninstall',
  'version',
]);

/** What nmr's help lists for one scope: each command that it runs, and the text that follows the options. */
export interface HelpListing {
  /** Each command's name, paired with the summary that the `Commands:` block shows for it. */
  commands: Array<[name: string, summary: string]>;
  epilog: string;
}

/**
 * Describes nmr's help for the scope anchored at `packageDir`: the active registry's commands, less hooks
 * (`*:pre`, `*:post`), then the scripts that the package's `package.json` adds to them, each summarized by the
 * shell command to which it resolves.
 *
 * The active registry is the root's when `shouldUseRoot` is true (root cwd or `-w`), and the workspace's otherwise.
 * A `package.json` entry that matches an active registry name replaces that row's value and marks it with `*`, which
 * a footnote explains. Every other entry, a hook included, is listed unless it is an npm or pnpm lifecycle script.
 * The epilog lists the inactive registry, the environment variables, and the files that nmr reads.
 */
export function describeHelp(
  config: NmrConfig,
  monorepoRoot: string,
  packageDir: string | undefined,
  shouldUseRoot: boolean,
): HelpListing {
  const packageScripts = packageDir === undefined ? {} : readRunnableScripts(packageDir);
  const fullActiveRegistry = shouldUseRoot ? buildRootRegistry(config, monorepoRoot) : buildWorkspaceRegistry(config);

  const activeRegistry = filterHooks(fullActiveRegistry);
  const markedNames = applyOverrides(activeRegistry, collectOverrides(packageScripts));
  const commands: Array<[string, string]> = Object.entries(activeRegistry).map(([name, value]) => [
    name,
    `${describeScript(value)}${markedNames.has(name) ? ' *' : ''}`,
  ]);
  const unregisteredScripts = collectUnregisteredScripts(packageScripts, fullActiveRegistry);
  for (const [name, value] of Object.entries(unregisteredScripts)) {
    commands.push([name, describeScript(value)]);
  }

  const inactiveRegistry = filterHooks(
    shouldUseRoot ? buildWorkspaceRegistry(config) : buildRootRegistry(config, monorepoRoot),
  );
  const lines = [...ENVIRONMENT_AND_FILES_LINES, '', shouldUseRoot ? 'Workspace commands:' : 'Root commands:'];
  formatRegistry(inactiveRegistry, new Set<string>(), lines);
  if (markedNames.size > 0) {
    lines.push('', '* Overridden by package.json');
  }

  return { commands, epilog: lines.join('\n') };
}

// region | Helpers

/** The environment variables and files that nmr reads, which help lists after its options. */
const ENVIRONMENT_AND_FILES_LINES: readonly string[] = [
  'Environment:',
  `  ${DELEGATE_ENV_VAR}                Hosts on which to run each command that can be delegated,`,
  '                              comma-separated; nmr runs on the first free one',
  `  ${OUTPUT_STYLE_ENV_VAR}            Output style: auto (default), plain, or rich. auto prints`,
  '                              plain, without emoji, when CI is set or the stream is not a terminal.',
  '',
  'Files:',
  "  ~/.config/nmr/config.ts     User config: this machine's delegation hosts, and when to use them",
  '                              ($XDG_CONFIG_HOME/nmr/config.ts when that is set)',
  '                              A command that it sends runs here when no host answers',
];

/**
 * Selects the hook-free entries of `packageScripts` as candidate overrides; `applyOverrides` decides which entries
 * actually match a registry name in the section being rendered.
 */
function collectOverrides(packageScripts: Record<string, string>): Record<string, string> {
  const candidateOverrides: Record<string, string> = {};
  for (const [name, value] of Object.entries(packageScripts)) {
    if (!isHookName(name)) candidateOverrides[name] = value;
  }
  return candidateOverrides;
}

/**
 * Selects the entries of `packageScripts` whose names `registry` does not contain, less lifecycle scripts.
 */
function collectUnregisteredScripts(
  packageScripts: Record<string, string>,
  registry: ScriptRegistry,
): Record<string, string> {
  const unregisteredScripts: Record<string, string> = {};
  for (const [name, value] of Object.entries(packageScripts)) {
    if (Object.hasOwn(registry, name) || LIFECYCLE_SCRIPT_NAMES.has(name)) continue;
    unregisteredScripts[name] = value;
  }
  return unregisteredScripts;
}

/**
 * Loads `packageDir`'s `package.json:scripts`, dropping self-referential entries, which resolution discards.
 */
function readRunnableScripts(packageDir: string): Record<string, string> {
  const scripts = readPackageJsonScripts(packageDir);
  if (!scripts) return {};

  const runnableScripts: Record<string, string> = {};
  for (const [name, value] of Object.entries(scripts)) {
    if (!isSelfReferential(value, name, packageDir)) runnableScripts[name] = value;
  }
  return runnableScripts;
}

/**
 * Applies tier-3 overrides to a section registry in place: for each candidate
 * override whose name matches a registry entry, replaces the registry value
 * with the override value and records the name. Returns the set of marked
 * names so that the renderer can attach the `*` marker.
 */
function applyOverrides(registry: ScriptRegistry, overrides: Record<string, string>): Set<string> {
  const markedNames = new Set<string>();
  for (const [name, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(registry, name)) {
      continue;
    }

    registry[name] = value;
    markedNames.add(name);
  }
  return markedNames;
}

/**
 * Returns a copy of `registry` with hook entries (`*:pre`, `*:post`) removed.
 */
function filterHooks(registry: ScriptRegistry): ScriptRegistry {
  const hooklessRegistry: ScriptRegistry = {};
  for (const [key, value] of Object.entries(registry)) {
    if (!isHookName(key)) hooklessRegistry[key] = value;
  }
  return hooklessRegistry;
}

/**
 * Renders each registry entry as `  <key><marker>  <value>`, where `marker`
 * is `*` for entries in `markedNames` and a space otherwise. The combined
 * `key + marker` is padded so that the value column lines up across marked
 * and unmarked rows.
 */
function formatRegistry(registry: ScriptRegistry, markedNames: Set<string>, lines: string[]): void {
  const keys = Object.keys(registry);
  if (keys.length === 0) return;

  const maxKeyLength = Math.max(...keys.map((k) => k.length));
  // Reserve 1 column for the `*` marker on every row and 2 for the gap before
  // the value column. The minimum (20) keeps narrow registries from collapsing.
  const padWidth = Math.max(maxKeyLength + 1 + 2, 20);

  for (const [key, value] of Object.entries(registry)) {
    const marker = markedNames.has(key) ? '*' : ' ';
    lines.push(`  ${(key + marker).padEnd(padWidth)} ${describeScript(value)}`);
  }
}

// endregion | Helpers
