import fs from 'node:fs';
import process from 'node:process';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, describe, expect, it as baseIt, vi } from 'vitest';

import { CHECKOUT_LOCK_PATH } from '../remote-host-session.ts';
import { CHECKOUT_STAMP_PATH, type CheckoutRemovalParams, removeStaleCheckouts } from '../removeStaleCheckouts.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const PARAMS: CheckoutRemovalParams = {
  checkoutsDir: '.cache/nmr/delegate',
  lockPath: CHECKOUT_LOCK_PATH,
  ownKey: 'own',
  removeAfterMs: 7 * DAY_MS,
  staleAfterMs: 60_000,
  stampPath: CHECKOUT_STAMP_PATH,
};

const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-remove-checkouts-' })),
);

describe(removeStaleCheckouts, () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('removes a checkout that has not been used for longer than the age, and keeps a recent one', async ({ tree }) => {
    addCheckout(tree, 'old', { ageDays: 8 });
    addCheckout(tree, 'recent', { ageDays: 6 });

    run(tree);

    await expectRemoved(tree, ['old']);
    expect(hasCheckout(tree, 'recent')).toBe(true);
  });

  it("keeps the delegation's own checkout, whatever its age", async ({ tree }) => {
    addCheckout(tree, 'own', { ageDays: 30 });
    addCheckout(tree, 'old', { ageDays: 30 });

    run(tree);

    await expectRemoved(tree, ['old']);
    expect(hasCheckout(tree, 'own')).toBe(true);
  });

  it('keeps an old checkout whose lock has a live holder', ({ tree }) => {
    addCheckout(tree, 'busy', { ageDays: 30, lockPid: process.pid });

    run(tree);

    expect(hasCheckout(tree, 'busy')).toBe(true);
  });

  it('removes an old checkout whose lock holder has exited', async ({ tree }) => {
    addCheckout(tree, 'abandoned', { ageDays: 30, lockPid: 2 ** 22 + 1 });

    run(tree);

    await expectRemoved(tree, ['abandoned']);
  });

  it('removes an old checkout whose lock has not been refreshed within the stale age', async ({ tree }) => {
    addCheckout(tree, 'abandoned', { ageDays: 30, lockAgeMs: 2 * PARAMS.staleAfterMs, lockPid: process.pid });

    run(tree);

    await expectRemoved(tree, ['abandoned']);
  });

  it("dates a checkout without a stamp by git's own files", async ({ tree }) => {
    addCheckout(tree, 'unstamped-old', { ageDays: 8, hasStamp: false });
    addCheckout(tree, 'unstamped-recent', { ageDays: 1, hasStamp: false });

    run(tree);

    await expectRemoved(tree, ['unstamped-old']);
    expect(hasCheckout(tree, 'unstamped-recent')).toBe(true);
  });

  it('dates a checkout by its newest record of use', ({ tree }) => {
    addCheckout(tree, 'restamped', { ageDays: 30 });
    touch(tree, `home/.cache/nmr/delegate/restamped/repo/${CHECKOUT_STAMP_PATH}`, 0);

    run(tree);

    expect(hasCheckout(tree, 'restamped')).toBe(true);
  });

  it('skips a key directory that does not contain exactly one checkout', ({ tree }) => {
    addCheckout(tree, 'crowded', { ageDays: 30 });
    tree.mkdir('home/.cache/nmr/delegate/crowded/other');
    tree.mkdir('home/.cache/nmr/delegate/empty');

    run(tree);

    expect(fs.existsSync(tree.resolve('home/.cache/nmr/delegate/crowded'))).toBe(true);
    expect(fs.existsSync(tree.resolve('home/.cache/nmr/delegate/empty'))).toBe(true);
  });

  it('removes nothing when removal is disabled', ({ tree }) => {
    addCheckout(tree, 'old', { ageDays: 365 });

    run(tree, { removeAfterMs: null });

    expect(hasCheckout(tree, 'old')).toBe(true);
  });

  it('deletes what an interrupted removal left in .removing', async ({ tree }) => {
    tree.write('home/.cache/nmr/delegate/.removing/leftover/file', '');

    run(tree);

    await expectRemoved(tree, []);
  });

  it('does nothing when the host does not have any checkouts', ({ tree }) => {
    expect(() => {
      run(tree);
    }).not.toThrow();
  });
});

// region | Helpers

/** Creates a checkout under the fake home whose records of use are `ageDays` old, optionally with a lock file. */
function addCheckout(
  tree: TempTree,
  key: string,
  options: { ageDays: number; hasStamp?: boolean; lockAgeMs?: number; lockPid?: number },
): void {
  const { ageDays, hasStamp = true, lockAgeMs = 0, lockPid } = options;
  const checkoutDir = `home/.cache/nmr/delegate/${key}/repo`;
  const files = ['.git/index', '.git/HEAD', ...(hasStamp ? [CHECKOUT_STAMP_PATH] : [])];
  for (const file of files) {
    touch(tree, `${checkoutDir}/${file}`, ageDays * DAY_MS);
  }
  if (lockPid === undefined) return;

  const lockPath = tree.write(`${checkoutDir}/${CHECKOUT_LOCK_PATH}`, JSON.stringify({ pid: lockPid }));
  setAge(lockPath, lockAgeMs);
}

/** Waits for the background deletion, then asserts that exactly `keys` are gone among the ones that the test made. */
async function expectRemoved(tree: TempTree, keys: string[]): Promise<void> {
  for (const key of keys) {
    expect(hasCheckout(tree, key)).toBe(false);
  }
  await vi.waitFor(() => {
    expect(fs.existsSync(tree.resolve('home/.cache/nmr/delegate/.removing'))).toBe(false);
  });
}

/** Reports whether the checkout under `key` still exists. */
function hasCheckout(tree: TempTree, key: string): boolean {
  return fs.existsSync(tree.resolve(`home/.cache/nmr/delegate/${key}/repo`));
}

/** Runs the removal with the tree's `home` as the home directory. */
function run(tree: TempTree, overrides: Partial<CheckoutRemovalParams> = {}): void {
  vi.stubEnv('HOME', tree.resolve('home'));
  removeStaleCheckouts({ ...PARAMS, ...overrides });
}

/** Sets a file's mtime to `ageMs` ago. */
function setAge(file: string, ageMs: number): void {
  const time = new Date(Date.now() - ageMs);
  fs.utimesSync(file, time, time);
}

/** Creates an empty file in the tree and sets its mtime to `ageMs` ago. */
function touch(tree: TempTree, relativePath: string, ageMs: number): void {
  setAge(tree.write(relativePath, ''), ageMs);
}

// endregion | Helpers
