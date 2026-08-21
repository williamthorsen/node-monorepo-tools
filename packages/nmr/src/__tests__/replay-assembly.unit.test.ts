import path from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import type { CheckCacheEntry, ReplayLine } from '../check-cache.ts';
import { writeCheckCacheEntry } from '../check-cache.ts';
import { assembleReplay } from '../replay-assembly.ts';
import type { Step } from '../steps.ts';
import { composeNmrStep } from '../steps.ts';

/** The tree every admissible entry in these tests describes. */
const TREE_HASH = 'tree-hash';

/** The run every admissible entry in these tests was certified by. */
const RUN_ID = 'the-run';

describe(assembleReplay, () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = disposeOnTestFinished(
      createTempTree(
        {
          'node_modules/': '',
          'packages/a/package.json': JSON.stringify({ name: 'a' }),
          'packages/b/package.json': JSON.stringify({ name: 'b' }),
          'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
        },
        { prefix: 'nmr-assembly-' },
      ),
    );
  });

  it('concatenates its constituents’ excerpts in the order its steps name them', async () => {
    await record({ command: 'typecheck', scopeDir: tree.dir });
    await record({ command: 'test', scopeDir: tree.dir });

    await expect(assemble([composeNmrStep('typecheck', false), composeNmrStep('test', false)])).resolves.toStrictEqual([
      lineFor('typecheck'),
      lineFor('test'),
    ]);
  });

  it('splices a constituent composite’s lines in flat, each keeping its own attribution', async () => {
    await record({
      command: 'check:strict',
      replay: [lineFor('typecheck'), lineFor('test', 'nmr-core')],
      scopeDir: tree.dir,
    });

    await expect(assemble([composeNmrStep('check:strict', false)])).resolves.toStrictEqual([
      lineFor('typecheck'),
      lineFor('test', 'nmr-core'),
    ]);
  });

  it('expands a delegate into the scopes it fans out to', async () => {
    await record({ command: 'test', scopeDir: tree.resolve('packages/a') });
    await record({ command: 'test', scopeDir: tree.resolve('packages/b') });

    await expect(assemble([composeNmrStep('-R test', false)])).resolves.toStrictEqual([
      lineFor('test', 'a'),
      lineFor('test', 'b'),
    ]);
  });

  // The witness is what narrows a filter's candidates, so the pattern itself needs no interpretation.
  it('takes a filtered delegate’s lines from the scopes that recorded under this run', async () => {
    await record({ command: 'test', scopeDir: tree.resolve('packages/a') });
    await record({ command: 'test', runId: 'another-run', scopeDir: tree.resolve('packages/b') });

    await expect(assemble([composeNmrStep('-F a test', false)])).resolves.toStrictEqual([lineFor('test', 'a')]);
  });

  // `-w` moves the child's anchor to the monorepo root, which is how a package-scoped composite reaches a
  // root command.
  it('reads a -w element at the monorepo root rather than at the composite’s own scope', async () => {
    const packageDir = tree.resolve('packages/a');
    await record({ command: 'lint:check', scopeDir: tree.dir });
    await record({ command: 'lint:check', scopeDir: packageDir });

    const replay = await assembleReplay({
      anchorDir: packageDir,
      monorepoRoot: tree.dir,
      runId: RUN_ID,
      steps: [composeNmrStep('-w lint:check', false)],
      treeHash: TREE_HASH,
    });

    expect(replay).toStrictEqual([lineFor('lint:check')]);
  });

  it('leaves out an excerpt another run certified', async () => {
    await record({ command: 'test', runId: 'another-run', scopeDir: tree.dir });

    await expect(assemble([composeNmrStep('test', false)])).resolves.toStrictEqual([]);
  });

  it('leaves out an excerpt describing another tree', async () => {
    await record({ command: 'test', scopeDir: tree.dir, treeHash: 'another-tree' });

    await expect(assemble([composeNmrStep('test', false)])).resolves.toStrictEqual([]);
  });

  it('leaves out a constituent that recorded no excerpt', async () => {
    await record({ command: 'test', hasRetention: false, scopeDir: tree.dir });

    await expect(assemble([composeNmrStep('test', false)])).resolves.toStrictEqual([]);
  });

  it('leaves out a constituent that recorded nothing at all', async () => {
    await expect(assemble([composeNmrStep('test', false)])).resolves.toStrictEqual([]);
  });

  it('reads no entry for an opaque step, whose own output the leaf path retains', async () => {
    await record({ command: 'test', scopeDir: tree.dir });

    await expect(assemble([{ kind: 'opaque', command: 'vitest' }])).resolves.toStrictEqual([]);
  });

  it('enumerates no scope for a delegate outside a workspace', async () => {
    tree.rm('pnpm-workspace.yaml');
    await record({ command: 'test', scopeDir: tree.resolve('packages/a') });

    await expect(assemble([composeNmrStep('-R test', false)])).resolves.toStrictEqual([]);
  });

  // region | Helpers

  /** Assembles what the given steps name, against the fixture's tree and run. */
  async function assemble(steps: readonly Step[]): Promise<ReplayLine[]> {
    return assembleReplay({ anchorDir: tree.dir, monorepoRoot: tree.dir, runId: RUN_ID, steps, treeHash: TREE_HASH });
  }

  /** Records the entry a constituent's run would leave behind at one scope. */
  async function record(options: {
    command: string;
    hasRetention?: boolean;
    replay?: ReplayLine[];
    runId?: string;
    scopeDir: string;
    treeHash?: string;
  }): Promise<void> {
    const scope = options.scopeDir === tree.dir ? 'root' : path.basename(options.scopeDir);
    const replay = options.replay ?? [lineFor(options.command, scope)];
    const entry: CheckCacheEntry = {
      key: `${options.command}-key`,
      treeHash: options.treeHash ?? TREE_HASH,
      headSha: 'head-sha',
      commandString: options.command,
      nmrVersion: '0.0.0',
      nodeVersion: 'v22.0.0',
      durationMs: 1_000,
      recordedAt: new Date().toISOString(),
      buildDigests: {},
      ...(options.hasRetention !== false && {
        retention: { key: `${options.command}-retention`, replay, runId: options.runId ?? RUN_ID },
      }),
    };

    await writeCheckCacheEntry({
      anchorDir: options.scopeDir,
      command: options.command,
      entry,
      monorepoRoot: tree.dir,
    });
  }

  // endregion | Helpers
});

// region | Helpers

/** Renders the line a scope's run of one command contributes. */
function lineFor(command: string, scope = 'root'): ReplayLine {
  return { command, excerpt: `${command} summary`, scope };
}

// endregion | Helpers
