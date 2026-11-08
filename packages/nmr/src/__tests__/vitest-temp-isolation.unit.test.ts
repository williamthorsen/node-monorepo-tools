import fs from 'node:fs';
import path from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setup } from '../vitest-temp-isolation.ts';

const DEAD_PID = 101;
const LIVE_PID = 102;
const FOREIGN_PID = 103;

describe('setup', () => {
  let base: TempTree;

  beforeEach(() => {
    base = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-temp-isolation-' }));
    vi.stubEnv('TMPDIR', base.dir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('points TMPDIR at a new run directory under the base, named for this process', () => {
    const teardown = setup();
    const runDir = process.env['TMPDIR'];
    teardown();

    expect(runDir).toBeDefined();
    expect(path.dirname(runDir ?? '')).toBe(base.dir);
    expect(path.basename(runDir ?? '')).toMatch(new RegExp(String.raw`^nmr-vitest-${process.pid}-.`));
  });

  it('removes the run directory and restores TMPDIR at teardown', () => {
    const teardown = setup();
    const runDir = process.env['TMPDIR'] ?? '';
    fs.writeFileSync(path.join(runDir, 'leftover.txt'), 'left by a test');

    teardown();

    expect(fs.existsSync(runDir)).toBe(false);
    expect(process.env['TMPDIR']).toBe(base.dir);
    expect(base.list()).toStrictEqual([]);
  });

  it('leaves TMPDIR unset at teardown when it was unset at setup', () => {
    // Node resolves the temp directory from TMP once TMPDIR is unset.
    vi.stubEnv('TMPDIR', undefined);
    vi.stubEnv('TMP', base.dir);

    const teardown = setup();
    const runDir = process.env['TMPDIR'] ?? '';
    teardown();

    expect(path.dirname(runDir)).toBe(base.dir);
    expect(process.env['TMPDIR']).toBeUndefined();
  });

  it('removes only the run directories whose owning process has exited', () => {
    base.write('other-dir/kept.txt', '');
    base.write(`nmr-vitest-${DEAD_PID}-aaaaaa/leftover.txt`, '');
    base.write(`nmr-vitest-${LIVE_PID}-bbbbbb/leftover.txt`, '');
    base.write(`nmr-vitest-${FOREIGN_PID}-cccccc/leftover.txt`, '');
    base.write('nmr-vitest-abc-dddddd/leftover.txt', '');
    base.write(`nmr-vitest-${DEAD_PID}-file`, '');
    stubProcessLiveness();

    setup()();

    expect(base.list()).toStrictEqual([
      `nmr-vitest-${DEAD_PID}-file`,
      `nmr-vitest-${LIVE_PID}-bbbbbb`,
      `nmr-vitest-${FOREIGN_PID}-cccccc`,
      'nmr-vitest-abc-dddddd',
      'other-dir',
    ]);
  });

  it('leaves an orphaned run directory in place when removing it fails', () => {
    base.write(`nmr-vitest-${DEAD_PID}-aaaaaa/leftover.txt`, '');
    stubProcessLiveness();
    const removeEntry = fs.rmSync.bind(fs);
    vi.spyOn(fs, 'rmSync')
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      })
      .mockImplementation(removeEntry);

    const teardown = setup();
    teardown();

    expect(base.list()).toStrictEqual([`nmr-vitest-${DEAD_PID}-aaaaaa`]);
  });
});

// region | Helpers

/** Makes `process.kill` report `DEAD_PID` as exited and `FOREIGN_PID` as owned by another user. */
function stubProcessLiveness(): void {
  vi.spyOn(process, 'kill').mockImplementation((pid) => {
    if (pid === DEAD_PID) throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    if (pid === FOREIGN_PID) throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    return true;
  });
}

// endregion | Helpers
