import path from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { PASS_MANIFEST_DIR_ENV_VAR } from '../check-cache.ts';
import {
  COMMAND,
  countRuns,
  LOG_ENTRY,
  runNmr,
  scaffoldRepo,
  writeConfig,
} from '../test-utils/check-cache-gate-fixtures.ts';

describe('the pass manifest', () => {
  let workspace: TempTree;
  let repo: string;
  let log: string;
  let manifestDir: string;

  beforeEach(() => {
    workspace = disposeOnTestFinished(createTempTree({ 'manifest/': '' }, { prefix: 'nmr-pass-manifest-' }));
    repo = workspace.resolve('repo');
    log = workspace.resolve(LOG_ENTRY);
    manifestDir = workspace.resolve('manifest');
    scaffoldRepo(workspace, log);
  });

  it('receives one entry for a recorded pass and one for a recalled pass', async () => {
    writeConfig(workspace, log, { command: `echo ran >> ${log} && echo '27 passed (27)'` });
    const env = { [PASS_MANIFEST_DIR_ENV_VAR]: manifestDir };

    await runNmr(COMMAND, repo, env);
    await runNmr(COMMAND, repo, env);

    expect(countRuns(workspace)).toBe(1);
    const entries = readEntries();
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry).toStrictEqual({
        command: COMMAND,
        commandString: expect.stringContaining('27 passed'),
        durationMs: expect.any(Number),
        replay: [{ command: COMMAND, excerpt: '27 passed (27)', scope: path.basename(repo) }],
        scope: '.',
        treeHash: expect.any(String),
      });
    }
    // A recall reports the time that the recorded pass took, which is the time that it saves.
    expect(entries[0]).toStrictEqual(entries[1]);
  });

  it('does not receive any entry when the variable is unset', async () => {
    await runNmr(COMMAND, repo);
    await runNmr(COMMAND, repo);

    expect(workspace.list('manifest')).toStrictEqual([]);
  });

  /** Parses every file in the manifest directory. */
  function readEntries(): unknown[] {
    return workspace.list('manifest').map((name): unknown => JSON.parse(workspace.read(path.join('manifest', name))));
  }
});
