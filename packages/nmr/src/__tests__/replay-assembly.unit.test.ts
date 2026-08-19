import fs from 'node:fs';
import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
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
  let root: string;

  beforeEach(() => {
    root = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-assembly-' })).dir;
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    for (const name of ['a', 'b']) {
      const packageDir = path.join(root, 'packages', name);
      fs.mkdirSync(packageDir, { recursive: true });
      fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name }));
    }
  });

  it('concatenates its constituents’ excerpts in the order its steps name them', async () => {
    await record({ command: 'typecheck', scopeDir: root });
    await record({ command: 'test', scopeDir: root });

    await expect(assemble([composeNmrStep('typecheck', false), composeNmrStep('test', false)])).resolves.toStrictEqual([
      lineFor('typecheck'),
      lineFor('test'),
    ]);
  });

  it('splices a constituent composite’s lines in flat, each keeping its own attribution', async () => {
    await record({
      command: 'check:strict',
      replay: [lineFor('typecheck'), lineFor('test:coverage', 'nmr-core')],
      scopeDir: root,
    });

    await expect(assemble([composeNmrStep('check:strict', false)])).resolves.toStrictEqual([
      lineFor('typecheck'),
      lineFor('test:coverage', 'nmr-core'),
    ]);
  });

  it('expands a delegate into the scopes it fans out to', async () => {
    await record({ command: 'test', scopeDir: path.join(root, 'packages', 'a') });
    await record({ command: 'test', scopeDir: path.join(root, 'packages', 'b') });

    await expect(assemble([composeNmrStep('-R test', false)])).resolves.toStrictEqual([
      lineFor('test', 'a'),
      lineFor('test', 'b'),
    ]);
  });

  // The witness is what narrows a filter's candidates, so the pattern itself needs no interpretation.
  it('takes a filtered delegate’s lines from the scopes that recorded under this run', async () => {
    await record({ command: 'test', scopeDir: path.join(root, 'packages', 'a') });
    await record({ command: 'test', runId: 'another-run', scopeDir: path.join(root, 'packages', 'b') });

    await expect(assemble([composeNmrStep('-F a test', false)])).resolves.toStrictEqual([lineFor('test', 'a')]);
  });

  // `-w` moves the child's anchor to the monorepo root, which is how a package-scoped composite reaches a
  // root command.
  it('reads a -w element at the monorepo root rather than at the composite’s own scope', async () => {
    const packageDir = path.join(root, 'packages', 'a');
    await record({ command: 'lint:check', scopeDir: root });
    await record({ command: 'lint:check', scopeDir: packageDir });

    const replay = await assembleReplay({
      anchorDir: packageDir,
      monorepoRoot: root,
      runId: RUN_ID,
      steps: [composeNmrStep('-w lint:check', false)],
      treeHash: TREE_HASH,
    });

    expect(replay).toStrictEqual([lineFor('lint:check')]);
  });

  it('leaves out an excerpt another run certified', async () => {
    await record({ command: 'test', runId: 'another-run', scopeDir: root });

    await expect(assemble([composeNmrStep('test', false)])).resolves.toStrictEqual([]);
  });

  it('leaves out an excerpt describing another tree', async () => {
    await record({ command: 'test', scopeDir: root, treeHash: 'another-tree' });

    await expect(assemble([composeNmrStep('test', false)])).resolves.toStrictEqual([]);
  });

  it('leaves out a constituent that recorded no excerpt', async () => {
    await record({ command: 'test', hasRetention: false, scopeDir: root });

    await expect(assemble([composeNmrStep('test', false)])).resolves.toStrictEqual([]);
  });

  it('leaves out a constituent that recorded nothing at all', async () => {
    await expect(assemble([composeNmrStep('test', false)])).resolves.toStrictEqual([]);
  });

  it('reads no entry for an opaque step, whose own output the leaf path retains', async () => {
    await record({ command: 'test', scopeDir: root });

    await expect(assemble([{ kind: 'opaque', command: 'vitest' }])).resolves.toStrictEqual([]);
  });

  it('enumerates no scope for a delegate outside a workspace', async () => {
    fs.rmSync(path.join(root, 'pnpm-workspace.yaml'));
    await record({ command: 'test', scopeDir: path.join(root, 'packages', 'a') });

    await expect(assemble([composeNmrStep('-R test', false)])).resolves.toStrictEqual([]);
  });

  // region | Helpers

  /** Assembles what the given steps name, against the fixture's tree and run. */
  async function assemble(steps: readonly Step[]): Promise<ReplayLine[]> {
    return assembleReplay({ anchorDir: root, monorepoRoot: root, runId: RUN_ID, steps, treeHash: TREE_HASH });
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
    const scope = options.scopeDir === root ? 'root' : path.basename(options.scopeDir);
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
      monorepoRoot: root,
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
