import type { NmrConfig } from './config.js';
import { isHookName } from './helpers/hook-name.js';
import type { ScriptRegistry } from './resolve-scripts.js';
import {
  buildRootRegistry,
  buildWorkspaceRegistry,
  describeScript,
  isSelfReferential,
  readPackageJsonScripts,
} from './resolver.js';

/**
 * Generates the help text for the `nmr` CLI. Renders only nmr commands —
 * names from the workspace and root registries, excluding hooks (`*:pre`,
 * `*:post`).
 *
 * When `packageDir` is provided, tier-3 entries from that package's
 * `package.json:scripts` that match a registry name in the active section
 * are inlined as overrides: the registry value is replaced with the
 * override value and the row's command name is suffixed with `*`. The
 * active section is the root section when `useRoot` is true (root cwd
 * or `-w`), otherwise the workspace section. A footnote is appended once
 * if any override marker was rendered.
 */
export function generateHelp(config: NmrConfig, packageDir: string | undefined, useRoot: boolean): string {
  const lines: string[] = [
    'Usage: nmr [flags] <command> [args...]',
    '',
    'Flags:',
    '  -F, --filter <pattern>   Run command in matching packages',
    '  -R, --recursive          Run command in all packages',
    '  -w, --workspace-root     Run root command regardless of cwd',
    '  -q, --quiet              Suppress output on success; show full output on failure',
    '  -?, --help               Show this help',
    '      --int-test           Use integration test scripts',
    '',
    'Workspace commands:',
  ];

  const overrides = packageDir === undefined ? {} : collectOverrides(packageDir);

  let hadOverride = false;

  const workspaceRegistry = filterHooks(buildWorkspaceRegistry(config, false));
  const workspaceMarked = !useRoot ? applyOverrides(workspaceRegistry, overrides) : new Set<string>();
  if (workspaceMarked.size > 0) hadOverride = true;
  formatRegistry(workspaceRegistry, workspaceMarked, lines);

  lines.push('', 'Root commands:');
  const rootRegistry = filterHooks(buildRootRegistry(config));
  const rootMarked = useRoot ? applyOverrides(rootRegistry, overrides) : new Set<string>();
  if (rootMarked.size > 0) hadOverride = true;
  formatRegistry(rootRegistry, rootMarked, lines);

  if (hadOverride) {
    lines.push('', '* Overridden by package.json');
  }

  return lines.join('\n');
}

/**
 * Loads `packageDir`'s `package.json:scripts`, dropping self-referential
 * entries and hook names. The result is a candidate map of overrides;
 * `applyOverrides` decides which entries actually match a registry name
 * in the section being rendered.
 */
function collectOverrides(packageDir: string): Record<string, string> {
  const scripts = readPackageJsonScripts(packageDir);
  if (!scripts) return {};

  const filtered: Record<string, string> = {};
  for (const [name, value] of Object.entries(scripts)) {
    if (isHookName(name)) continue;
    if (isSelfReferential(value, name)) continue;
    filtered[name] = value;
  }
  return filtered;
}

/**
 * Applies tier-3 overrides to a section registry in place: for each candidate
 * override whose name matches a registry entry, replaces the registry value
 * with the override value and records the name. Returns the set of marked
 * names so the renderer can attach the `*` marker.
 */
function applyOverrides(registry: ScriptRegistry, overrides: Record<string, string>): Set<string> {
  const marked = new Set<string>();
  for (const [name, value] of Object.entries(overrides)) {
    if (name in registry) {
      registry[name] = value;
      marked.add(name);
    }
  }
  return marked;
}

/**
 * Returns a copy of `registry` with hook entries (`*:pre`, `*:post`) removed.
 */
function filterHooks(registry: ScriptRegistry): ScriptRegistry {
  const filtered: ScriptRegistry = {};
  for (const [key, value] of Object.entries(registry)) {
    if (!isHookName(key)) filtered[key] = value;
  }
  return filtered;
}

/**
 * Renders each registry entry as `  <key><marker>  <value>`, where `marker`
 * is `*` for entries in `marked` and a space otherwise. The combined
 * `key + marker` is padded so the value column lines up across marked and
 * unmarked rows.
 */
function formatRegistry(registry: ScriptRegistry, marked: Set<string>, lines: string[]): void {
  const keys = Object.keys(registry);
  if (keys.length === 0) return;

  const maxKeyLen = Math.max(...keys.map((k) => k.length));
  // +1 so there is room for the `*` marker character on every row, +2 to
  // preserve the prior gap before the value column. The minimum (20) keeps
  // narrow registries from collapsing.
  const pad = Math.max(maxKeyLen + 1 + 2, 20);

  for (const [key, value] of Object.entries(registry)) {
    const marker = marked.has(key) ? '*' : ' ';
    lines.push(`  ${(key + marker).padEnd(pad)} ${describeScript(value)}`);
  }
}
