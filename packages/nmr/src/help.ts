import { isHookName } from './helpers/hook-name.ts';
import { OUTPUT_STYLE_ENV_VAR, OUTPUT_STYLE_FLAG } from './output-style.ts';
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

/**
 * Generates the help text for the `nmr` CLI. Renders the names from the
 * workspace and root registries, excluding hooks (`*:pre`, `*:post`), and
 * the scripts that the package at `packageDir` adds to them.
 *
 * When `packageDir` is provided, tier-3 entries from that package's
 * `package.json:scripts` that match a registry name in the active section
 * are inlined as overrides: The registry value is replaced with the
 * override value and the row's command name is suffixed with `*`. The
 * active section is the root section when `shouldUseRoot` is true (root cwd
 * or `-w`), otherwise the workspace section. A footnote is appended once
 * if any override marker was rendered.
 *
 * Every other entry, a hook included, is listed under `Package scripts:`
 * unless it is an npm or pnpm lifecycle script or the active registry
 * contains its name.
 */
export function generateHelp(
  config: NmrConfig,
  monorepoRoot: string,
  packageDir: string | undefined,
  shouldUseRoot: boolean,
): string {
  const lines: string[] = [
    'Usage: nmr [flags] <command> [args...]',
    '',
    'Flags:',
    '  -F, --filter <pattern>      Run command in packages whose manifest name matches',
    '  -R, --recursive             Run command in all packages',
    '  -w, --workspace-root        Use root scripts, running at the monorepo root',
    "  -q, --quiet                 Suppress command output, keeping nmr's verdicts",
    '      --json                  Report one JSON object per command, withholding command output',
    '      --log                   Print the recorded run instead of running (up to 256 KiB)',
    '      --no-cache              Run even if this tree already passed; record the result',
    `      ${OUTPUT_STYLE_FLAG} <style>  Output style: auto (default), plain, or rich`,
    '  -?, --help                  Show this help',
    '  -V, --version               Show version number',
    '',
    'Environment:',
    `  ${OUTPUT_STYLE_ENV_VAR}            Output style: auto (default), plain, or rich. auto prints`,
    '                              plain, without emoji, when CI is set or the stream is not a terminal.',
    '',
    'Workspace commands:',
  ];

  const packageScripts = packageDir === undefined ? {} : readRunnableScripts(packageDir);
  const overrides = collectOverrides(packageScripts);

  let hadOverride = false;

  const workspaceRegistry = filterHooks(buildWorkspaceRegistry(config));
  const workspaceMarkedNames = !shouldUseRoot ? applyOverrides(workspaceRegistry, overrides) : new Set<string>();
  if (workspaceMarkedNames.size > 0) hadOverride = true;
  formatRegistry(workspaceRegistry, workspaceMarkedNames, lines);

  lines.push('', 'Root commands:');
  const rootRegistry = filterHooks(buildRootRegistry(config, monorepoRoot));
  const rootMarkedNames = shouldUseRoot ? applyOverrides(rootRegistry, overrides) : new Set<string>();
  if (rootMarkedNames.size > 0) hadOverride = true;
  formatRegistry(rootRegistry, rootMarkedNames, lines);

  const activeRegistry = shouldUseRoot ? buildRootRegistry(config, monorepoRoot) : buildWorkspaceRegistry(config);
  const unregisteredScripts = collectUnregisteredScripts(packageScripts, activeRegistry);
  if (Object.keys(unregisteredScripts).length > 0) {
    lines.push('', 'Package scripts:');
    formatRegistry(unregisteredScripts, new Set<string>(), lines);
  }

  if (hadOverride) {
    lines.push('', '* Overridden by package.json');
  }

  return lines.join('\n');
}

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
