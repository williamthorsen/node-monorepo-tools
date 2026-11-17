import { describe, expect, it } from 'vitest';

import { readRunnerSelection, type RunnerSelection } from '../../.readyup/lib/runner-selection.ts';

describe(readRunnerSelection, () => {
  it.each<[string | undefined, RunnerSelection]>([
    [undefined, { kind: 'unset' }],
    [' ', { kind: 'unset' }],
    ['self-hosted', { kind: 'self-hosted', labels: ['self-hosted'] }],
    ['thor-x1-370-runners', { kind: 'self-hosted', labels: ['thor-x1-370-runners'] }],
    ['"thor-x1-370-runners"', { kind: 'self-hosted', labels: ['thor-x1-370-runners'] }],
    ['["self-hosted", "linux"]', { kind: 'self-hosted', labels: ['self-hosted', 'linux'] }],
    ['["ubuntu-latest", "self-hosted"]', { kind: 'self-hosted', labels: ['ubuntu-latest', 'self-hosted'] }],
    ['{"group": "pool"}', { kind: 'self-hosted', labels: [], group: 'pool' }],
    ['{"group": "pool", "labels": []}', { kind: 'self-hosted', labels: [], group: 'pool' }],
    ['{"group": "pool", "labels": "linux"}', { kind: 'self-hosted', labels: ['linux'], group: 'pool' }],
    ['ubuntu-latest', { kind: 'hosted', labels: ['ubuntu-latest'] }],
    ['"macos-14"', { kind: 'hosted', labels: ['macos-14'] }],
    ['["ubuntu-24.04", "windows-latest"]', { kind: 'hosted', labels: ['ubuntu-24.04', 'windows-latest'] }],
  ])('classifies %j', (value, selection) => {
    expect(readRunnerSelection(value)).toStrictEqual(selection);
  });

  it.each([
    ['[oops', 'opens with [ but is not JSON'],
    ['{"x": 1}', 'is JSON but does not name runner labels or a runner group'],
    ['[1]', 'is JSON but does not name runner labels or a runner group'],
    ['[]', 'is JSON but does not name runner labels or a runner group'],
    ['""', 'is JSON but does not name runner labels or a runner group'],
    ['["", "x"]', 'is JSON but does not name runner labels or a runner group'],
    ['{"group": ""}', 'is JSON but does not name runner labels or a runner group'],
  ])('classifies %j as invalid', (value, problem) => {
    expect(readRunnerSelection(value)).toStrictEqual({ kind: 'invalid', problem });
  });
});
