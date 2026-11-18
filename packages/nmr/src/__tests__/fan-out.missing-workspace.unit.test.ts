import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import type { ResolvedContext } from '../context.ts';
import { runDelegation } from '../fan-out.ts';
import type { ParsedArgs } from '../nmr-flags.ts';

const ROOT = '/repos/plain';

const CONTEXT: ResolvedContext = {
  monorepoRoot: ROOT,
  hasWorkspace: false,
  isRoot: true,
  workspacePackageDirs: [],
  config: {},
};

const BASE_ARGS: ParsedArgs = {
  isWorkspaceRoot: false,
  quiet: false,
  recursive: false,
  shouldBypassCache: false,
  shouldBypassLock: false,
  shouldDelegate: false,
  shouldEmitJson: false,
  shouldPrintLog: false,
  shouldRunLocally: false,
  shouldShowHelp: false,
  shouldShowVersion: false,
  command: 'lint',
  passthrough: [],
};

describe(runDelegation, () => {
  it('refuses -R at a root without a workspace, naming the missing manifest', async () => {
    const { readFilterSelection, result, runSteps, stderr } = await runAt({ ...BASE_ARGS, recursive: true });

    expect(result.exitCode).toBe(1);
    expect(stderr).toContain(
      `-R/--recursive needs a pnpm workspace: no pnpm-workspace.yaml in ${ROOT} or any parent directory.`,
    );
    expect(readFilterSelection).not.toHaveBeenCalled();
    expect(runSteps).not.toHaveBeenCalled();
  });

  it('refuses -F before asking pnpm what the pattern selects', async () => {
    const { readFilterSelection, result, runSteps, stderr } = await runAt({ ...BASE_ARGS, filter: 'core' });

    expect(result.exitCode).toBe(1);
    expect(stderr).toContain(
      `-F/--filter needs a pnpm workspace: \`core\` was not matched, because no pnpm-workspace.yaml is in ${ROOT} ` +
        'or any parent directory.',
    );
    expect(readFilterSelection).not.toHaveBeenCalled();
    expect(runSteps).not.toHaveBeenCalled();
  });
});

// region | Helpers

/** Runs a delegation at the workspace-free root and returns what it wrote to stderr. */
async function runAt(parsedArgs: ParsedArgs) {
  const stderrStream = new PassThrough();
  const chunks: string[] = [];
  stderrStream.on('data', (chunk: Buffer) => {
    chunks.push(chunk.toString('utf8'));
  });
  const readFilterSelection = vi.fn(() => 'multiple' as const);
  const runSteps = vi.fn(() => Promise.resolve({ exitCode: 0 }));

  const result = await runDelegation({
    context: CONTEXT,
    delegation: { env: {}, step: { kind: 'structural', argv: ['pnpm', '--recursive', 'exec', 'nmr', 'lint'] } },
    parsedArgs,
    readFilterSelection,
    runOptions: { bin: 'nmr', quiet: false, stdout: new PassThrough(), stderr: stderrStream, env: {} },
    runSteps,
    stderr: stderrStream,
  });

  return { readFilterSelection, result, runSteps, stderr: chunks.join('') };
}

// endregion | Helpers
