import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { STALE_AFTER_MS } from '../machine-lock.ts';
import { CHECKOUT_LOCK_PATH } from '../remote-host-session.ts';
import { probeHost, type ProbeReport, type ProbeResult } from '../remote-probe.ts';
import { createFakeRemote, type FakeRemote } from '../test-utils/fake-remote.ts';

const CHECKOUT_PATH = '.cache/nmr/delegate/0123456789abcdef/repo';

/** The checkout's lock on the fake host `box`, relative to the temporary tree. */
const HOST_CHECKOUT_LOCK_PATH = `fake-home/hosts/box/${CHECKOUT_PATH}/${CHECKOUT_LOCK_PATH}`;

/** The machine lock on the fake host `box`, under the lock directory that its `ssh` sets. */
const MACHINE_LOCK_PATH = 'fake-home/hosts/box/nmr-lock/heavy.lock';

describe('a lock probe of a fake host', () => {
  let workspace: TempTree;
  let remote: FakeRemote;

  beforeEach(() => {
    workspace = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-remote-probe-' }));
    remote = createFakeRemote(workspace);
    remote.addHost('box');
  });

  it('reports a host without any lock as free', async () => {
    await expect(probe('box')).resolves.toStrictEqual(report('free'));
  });

  it('reports a live holder of the machine lock as busy', async () => {
    writeLock(MACHINE_LOCK_PATH, { pid: process.pid });

    await expect(probe('box')).resolves.toStrictEqual(report('busy'));
  });

  it("reports a live holder of the checkout's lock as busy", async () => {
    writeLock(HOST_CHECKOUT_LOCK_PATH, { pid: process.pid });

    await expect(probe('box')).resolves.toStrictEqual(report('busy'));
  });

  it('reports a recent lock file that does not parse as busy', async () => {
    writeLock(MACHINE_LOCK_PATH, '{"pid":');

    await expect(probe('box')).resolves.toStrictEqual(report('busy'));
  });

  it('reports a lock whose holder has exited as free', async () => {
    writeLock(MACHINE_LOCK_PATH, { pid: readExitedPid() });

    await expect(probe('box')).resolves.toStrictEqual(report('free'));
  });

  it('reports a lock that its holder stopped refreshing as free', async () => {
    const lockPath = writeLock(MACHINE_LOCK_PATH, { pid: process.pid });
    const abandonedAt = new Date(Date.now() - STALE_AFTER_MS - 1_000);
    fs.utimesSync(lockPath, abandonedAt, abandonedAt);

    await expect(probe('box')).resolves.toStrictEqual(report('free'));
  });

  it('reports a host that ssh cannot connect to as unreachable, with what ssh printed', async () => {
    await expect(probe('unreachable')).resolves.toStrictEqual({
      result: 'unreachable',
      sshMessage: 'ssh: connect to host unreachable: Connection refused',
    });
  });

  it("probes through the environment's GIT_SSH_COMMAND", async () => {
    const wrapper = remote.addSshWrapper();

    await expect(probe('box', { GIT_SSH_COMMAND: wrapper.command })).resolves.toStrictEqual(report('free'));
    expect(wrapper.readLog()).toStrictEqual([expect.stringContaining('BatchMode=yes')]);
  });

  /** Probes `host` through the fake `ssh`. */
  function probe(host: string, extraEnv: Record<string, string> = {}) {
    return probeHost({
      checkoutPath: CHECKOUT_PATH,
      env: remote.buildEnv(extraEnv),
      host,
      signal: new AbortController().signal,
    });
  }

  /** Writes a lock file on the fake host, as a holder record or raw content, and returns its path. */
  function writeLock(lockPath: string, content: Record<string, unknown> | string): string {
    return workspace.write(lockPath, typeof content === 'string' ? content : JSON.stringify(content));
  }
});

// region | Helpers

/** Returns the pid of a process that has already exited. */
function readExitedPid(): number {
  return spawnSync('true').pid;
}

/** Returns a probe report without an ssh message. */
function report(result: ProbeResult): ProbeReport {
  return { result, sshMessage: '' };
}

// endregion | Helpers
