import type { NmrConfig } from './config.js';
import type { ScriptRegistry } from './registries.js';
import { buildRootRegistry, buildWorkspaceRegistry } from './resolver.js';
import { describeScript } from './resolver.js';

/**
 * Generates the help text for the `nmr` CLI, showing commands
 * from both workspace and root script registries.
 */
export function generateHelp(config: NmrConfig): string {
  const lines: string[] = [
    'Usage: nmr [flags] <command> [args...]',
    '',
    'Flags:',
    '  -F, --filter <pattern>   Run command in matching packages',
    '  -R, --recursive          Run command in all packages',
    '  -w, --workspace-root     Run root command regardless of cwd',
    '  -?, --help               Show this help',
    '      --int-test           Use integration test scripts',
    '',
    'Workspace commands:',
  ];

  formatRegistry(buildWorkspaceRegistry(config, false), lines);
  lines.push('', 'Root commands:');
  formatRegistry(buildRootRegistry(config), lines);

  return lines.join('\n');
}

function formatRegistry(registry: ScriptRegistry, lines: string[]): void {
  const maxKeyLen = Math.max(...Object.keys(registry).map((k) => k.length));
  const pad = Math.max(maxKeyLen + 2, 20);

  for (const [key, value] of Object.entries(registry)) {
    lines.push(`  ${key.padEnd(pad)} ${describeScript(value)}`);
  }
}
