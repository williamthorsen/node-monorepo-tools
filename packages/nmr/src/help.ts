import type { NmrConfig } from './config.js';
import type { ScriptRegistry } from './resolve-scripts.js';
import {
  buildRootRegistry,
  buildWorkspaceRegistry,
  describeScript,
  isSelfReferential,
  readPackageJsonScripts,
} from './resolver.js';

/**
 * Generates the help text for the `nmr` CLI, showing commands
 * from both workspace and root script registries. When `packageDir`
 * is provided, also lists non-self-referential scripts from that
 * package's `package.json` under a "Package scripts:" section.
 */
export function generateHelp(config: NmrConfig, packageDir?: string): string {
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

  formatRegistry(buildWorkspaceRegistry(config, false), lines);
  lines.push('', 'Root commands:');
  formatRegistry(buildRootRegistry(config), lines);

  if (packageDir !== undefined) {
    const packageScripts = collectPackageScripts(packageDir);
    if (Object.keys(packageScripts).length > 0) {
      lines.push('', 'Package scripts:');
      formatRegistry(packageScripts, lines);
    }
  }

  return lines.join('\n');
}

/**
 * Loads a package's `package.json` scripts and removes self-referential entries
 * (e.g., `"build": "nmr build"`) which would appear as redundant duplicates of
 * the workspace command. Returns an empty object when no scripts are present.
 */
function collectPackageScripts(packageDir: string): Record<string, string> {
  const scripts = readPackageJsonScripts(packageDir);
  if (!scripts) return {};

  const filtered: Record<string, string> = {};
  for (const [name, value] of Object.entries(scripts)) {
    if (!isSelfReferential(value, name)) {
      filtered[name] = value;
    }
  }
  return filtered;
}

function formatRegistry(registry: ScriptRegistry, lines: string[]): void {
  const maxKeyLen = Math.max(...Object.keys(registry).map((k) => k.length));
  const pad = Math.max(maxKeyLen + 2, 20);

  for (const [key, value] of Object.entries(registry)) {
    lines.push(`  ${key.padEnd(pad)} ${describeScript(value)}`);
  }
}
