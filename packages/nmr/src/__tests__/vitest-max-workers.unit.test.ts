import { describe, expect, it } from 'vitest';

import { deriveDefaultMaxWorkers, readMaxWorkersFlag } from '../vitest-max-workers.ts';

const GIB = 2 ** 30;

describe(deriveDefaultMaxWorkers, () => {
  it('gives a machine with two or fewer cores three workers, whatever the memory', () => {
    for (const coreCount of [1, 2]) {
      for (const totalMemoryBytes of [2 * GIB, 64 * GIB]) {
        expect(deriveDefaultMaxWorkers({ coreCount, totalMemoryBytes })).toBe(3);
      }
    }
  });

  it('allows one worker per 4 GiB of total memory', () => {
    expect(deriveDefaultMaxWorkers({ coreCount: 10, totalMemoryBytes: 16 * GIB })).toBe(4);
    expect(deriveDefaultMaxWorkers({ coreCount: 10, totalMemoryBytes: 23 * GIB })).toBe(5);
  });

  it('allows no more workers than one fewer than the cores', () => {
    expect(deriveDefaultMaxWorkers({ coreCount: 4, totalMemoryBytes: 64 * GIB })).toBe(3);
  });

  it('allows at least one worker on a machine with little memory', () => {
    expect(deriveDefaultMaxWorkers({ coreCount: 8, totalMemoryBytes: 2 * GIB })).toBe(1);
  });
});

describe(readMaxWorkersFlag, () => {
  it.each([
    [['--maxWorkers=2'], 2],
    [['--maxWorkers', '2'], 2],
    [['--max-workers=2'], 2],
    [['--max-workers', '2'], 2],
    [['--maxWorkers=50%'], '50%'],
    [['--project', 'unit', '--maxWorkers', '4', '--coverage'], 4],
  ])('reads %j as %j', (args, expected) => {
    expect(readMaxWorkersFlag(args)).toBe(expected);
  });

  it('takes the last occurrence when the flag repeats', () => {
    expect(readMaxWorkersFlag(['--maxWorkers=2', '--max-workers', '6'])).toBe(6);
  });

  it.each([[[]], [['--maxWorkers']], [['--maxWorkers=0']], [['--maxWorkers', 'many']], [['--maxWorkersX=2']]])(
    'treats %j as absent',
    (args) => {
      expect(readMaxWorkersFlag(args)).toBeUndefined();
    },
  );
});
