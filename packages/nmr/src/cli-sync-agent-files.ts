/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { check, sync } from './commands/sync-agent-files.js';
import { findMonorepoRoot } from './context.js';

function parseArgs(argv: string[]): { mode: 'sync' | 'check' } | { error: string } {
  const args = argv.slice(2);
  if (args.length === 0) return { mode: 'sync' };
  if (args.length === 1 && args[0] === '--check') return { mode: 'check' };
  return { error: `Usage: nmr sync-agent-files [--check]` };
}

try {
  const parsed = parseArgs(process.argv);
  if ('error' in parsed) {
    console.error(parsed.error);
    process.exit(1);
  }

  const monorepoRoot = findMonorepoRoot();

  if (parsed.mode === 'sync') {
    const { written, stamp } = sync(monorepoRoot);
    console.info(`✓ Wrote ${written} (${stamp})`);
    process.exit(0);
  }

  const result = check(monorepoRoot);
  if (result.ok) {
    console.info(`✓ .agents/nmr/AGENTS.md is in sync (${result.stamp})`);
    process.exit(0);
  }
  console.error(result.reason);
  process.exit(1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
