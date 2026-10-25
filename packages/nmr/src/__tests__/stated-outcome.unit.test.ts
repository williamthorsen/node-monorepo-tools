import fs from 'node:fs';
import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt, vi } from 'vitest';

import { OUTCOME_FILE_ENV_VAR, readStatedOutcome, writeStatedOutcome } from '../stated-outcome.ts';

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-stated-outcome-' })),
);

describe(readStatedOutcome, () => {
  it.for([
    { case: 'with a saving', outcome: { kind: 'build-unchanged', savedMs: 2_100 } as const },
    { case: 'without a saving', outcome: { kind: 'build-unchanged' } as const },
  ])('reads back what writeStatedOutcome wrote, $case', async ({ outcome }, { tree }) => {
    const filePath = path.join(tree.dir, 'outcome.json');
    await writeStatedOutcome({ [OUTCOME_FILE_ENV_VAR]: filePath }, outcome);

    await expect(readStatedOutcome(filePath, vi.fn())).resolves.toStrictEqual(outcome);
  });

  it('returns undefined without a rejection when the step wrote nothing', async ({ tree }) => {
    const onRejection = vi.fn();

    await expect(readStatedOutcome(path.join(tree.dir, 'absent.json'), onRejection)).resolves.toBeUndefined();
    expect(onRejection).not.toHaveBeenCalled();
  });

  it.for([
    { case: 'is not JSON', text: '{"kind":"build-' },
    { case: 'names a kind that this nmr does not know', text: '{"kind":"tests-flaky"}' },
    { case: 'has a negative saving', text: '{"kind":"build-unchanged","savedMs":-1}' },
    { case: 'has a saving that is not a number', text: '{"kind":"build-unchanged","savedMs":"2s"}' },
    { case: 'is an array', text: '[]' },
  ])('rejects a record that $case', async ({ text }, { tree }) => {
    const filePath = tree.write('outcome.json', text);
    const onRejection = vi.fn();

    await expect(readStatedOutcome(filePath, onRejection)).resolves.toBeUndefined();
    expect(onRejection).toHaveBeenCalledTimes(1);
  });

  it('drops a field that the record does not define', async ({ tree }) => {
    const filePath = tree.write('outcome.json', '{"kind":"build-unchanged","savedMs":5,"extra":true}');

    await expect(readStatedOutcome(filePath, vi.fn())).resolves.toStrictEqual({ kind: 'build-unchanged', savedMs: 5 });
  });
});

describe(writeStatedOutcome, () => {
  it.for([
    { case: 'unset', env: {} },
    { case: 'empty', env: { [OUTCOME_FILE_ENV_VAR]: '' } },
  ])('writes nothing when the variable is $case', async ({ env }, { tree }) => {
    await writeStatedOutcome(env, { kind: 'build-unchanged' });

    expect(fs.readdirSync(tree.dir)).toStrictEqual([]);
  });

  it('does not throw when the file cannot be written', async ({ tree }) => {
    const env = { [OUTCOME_FILE_ENV_VAR]: path.join(tree.dir, 'missing-dir', 'outcome.json') };

    await expect(writeStatedOutcome(env, { kind: 'build-unchanged' })).resolves.toBeUndefined();
  });
});
