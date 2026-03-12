/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import process from 'node:process';

import { resolveContext } from './context.js';
import { generateHelp } from './help.js';
import { buildRootRegistry, buildWorkspaceRegistry, resolveScript } from './resolver.js';
import { runCommand } from './runner.js';

interface ParsedArgs {
  filter?: string;
  recursive: boolean;
  workspaceRoot: boolean;
  help: boolean;
  intTest: boolean;
  command?: string;
  passthrough: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    recursive: false,
    workspaceRoot: false,
    help: false,
    intTest: false,
    passthrough: [],
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === undefined) break;

    if (arg === '-F' || arg === '--filter') {
      i++;
      const filterValue = args[i];
      if (filterValue === undefined) {
        console.error('Error: -F/--filter requires a pattern argument');
        process.exit(1);
      }
      result.filter = filterValue;
      i++;
      continue;
    }
    if (arg === '-R' || arg === '--recursive') {
      result.recursive = true;
      i++;
      continue;
    }
    if (arg === '-w' || arg === '--workspace-root') {
      result.workspaceRoot = true;
      i++;
      continue;
    }
    if (arg === '-?' || arg === '--help') {
      result.help = true;
      i++;
      continue;
    }
    if (arg === '--int-test') {
      result.intTest = true;
      i++;
      continue;
    }

    // First non-flag argument is the command; rest is passthrough
    result.command = arg;
    result.passthrough = args.slice(i + 1);
    break;
  }

  return result;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);
  const context = await resolveContext();

  if (parsed.help || !parsed.command) {
    console.info(generateHelp(context.config));
    process.exit(0);
  }

  const { command } = parsed;
  const passthrough = parsed.passthrough.length > 0 ? ' ' + parsed.passthrough.join(' ') : '';

  // -F: delegate to pnpm --filter
  if (parsed.filter) {
    const delegateCmd = `pnpm --filter ${parsed.filter} exec nmr ${command}${passthrough}`;
    const code = runCommand(delegateCmd, context.monorepoRoot);
    process.exit(code);
  }

  // -R: delegate to pnpm --recursive
  if (parsed.recursive) {
    const delegateCmd = `pnpm --recursive exec nmr ${command}${passthrough}`;
    const code = runCommand(delegateCmd, context.monorepoRoot);
    process.exit(code);
  }

  // Determine which registry to use
  const useRoot = parsed.workspaceRoot || context.isRoot;
  const registry = useRoot ? buildRootRegistry(context.config) : buildWorkspaceRegistry(context.config, parsed.intTest);

  const resolved = resolveScript(command, registry, context.packageDir);

  if (!resolved) {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }

  if (resolved.command === '') {
    console.info('Override script is defined but empty. Skipping.');
    process.exit(0);
  }

  if (resolved.source === 'package') {
    console.info(`Using override script: ${resolved.command}`);
  }

  const fullCommand = resolved.command + passthrough;
  const code = runCommand(fullCommand);
  process.exit(code);
}

try {
  await main();
} catch (error: unknown) {
  console.error(error);
  process.exit(1);
}
