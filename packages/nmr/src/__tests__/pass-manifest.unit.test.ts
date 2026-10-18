import path from 'node:path';
import { PassThrough } from 'node:stream';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { DEBUG_ENV_VAR, PASS_MANIFEST_DIR_ENV_VAR } from '../check-cache.ts';
import { writePassManifestEntry } from '../pass-manifest.ts';

describe(writePassManifestEntry, () => {
  let tree: TempTree;
  let manifestDir: string;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({ 'manifest/': '' }, { prefix: 'nmr-pass-manifest-' }));
    manifestDir = tree.resolve('manifest');
  });

  it('writes one file per entry, naming the scope relative to the root', async () => {
    await writeEntry({ anchorDir: tree.resolve('packages/a') });
    await writeEntry({ anchorDir: tree.dir, command: 'ci' });

    expect(readEntries()).toStrictEqual(
      expect.arrayContaining([
        {
          command: 'test',
          commandString: 'vitest run',
          durationMs: 1_200,
          replay: [{ command: 'test', excerpt: '3 passed', scope: 'a' }],
          scope: 'packages/a',
          treeHash: 'tree-id',
        },
        expect.objectContaining({ command: 'ci', scope: '.' }),
      ]),
    );
    expect(readEntries()).toHaveLength(2);
  });

  it('leaves out the replay when there is nothing to replay', async () => {
    await writeEntry({ replay: undefined });
    await writeEntry({ replay: [] });

    expect(readEntries()).toStrictEqual([
      expect.not.objectContaining({ replay: expect.anything() }),
      expect.not.objectContaining({ replay: expect.anything() }),
    ]);
  });

  it('does not write anything when the variable is unset', async () => {
    await writeEntry({ env: {} });

    expect(tree.list('manifest')).toStrictEqual([]);
  });

  it('reports a directory that cannot be written in the debug note, without throwing', async () => {
    const stderr = captureStream();

    await writeEntry({
      env: { [DEBUG_ENV_VAR]: '1', [PASS_MANIFEST_DIR_ENV_VAR]: tree.resolve('missing') },
      stderr: stderr.stream,
    });

    expect(stderr.read()).toContain('could not report test to the delegating machine');
  });

  /** Writes an entry for `test` into the manifest directory, with any option overridden. */
  async function writeEntry(overrides: Partial<Parameters<typeof writePassManifestEntry>[0]> = {}): Promise<void> {
    await writePassManifestEntry({
      anchorDir: tree.dir,
      command: 'test',
      commandString: 'vitest run',
      durationMs: 1_200,
      env: { [PASS_MANIFEST_DIR_ENV_VAR]: manifestDir },
      monorepoRoot: tree.dir,
      replay: [{ command: 'test', excerpt: '3 passed', scope: 'a' }],
      stderr: new PassThrough(),
      treeHash: 'tree-id',
      ...overrides,
    });
  }

  /** Parses every file in the manifest directory. */
  function readEntries(): unknown[] {
    return tree.list('manifest').map((name): unknown => JSON.parse(tree.read(path.join('manifest', name))));
  }
});

// region | Helpers

/** Returns a writable stream and a reader of everything written to it. */
function captureStream(): { read: () => string; stream: PassThrough } {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  return { read: () => Buffer.concat(chunks).toString('utf8'), stream };
}

// endregion | Helpers
