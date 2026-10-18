import { describe, expect, it } from 'vitest';

import { chooseHost, type ProbeResult, selectHost } from '../remote-probe.ts';
import type { HostList } from '../remote-run.ts';

const HOSTS: HostList = ['a', 'b', 'c'];

describe(selectHost, () => {
  it.for<{ case: string; expected: string | undefined; results: Record<string, ProbeResult> }>([
    { case: 'the first host is free', results: { a: 'free' }, expected: 'a' },
    { case: 'an earlier host is busy and a later one is free', results: { a: 'busy', b: 'free' }, expected: 'b' },
    { case: 'an earlier host has not answered yet', results: { b: 'free', c: 'free' }, expected: undefined },
    { case: 'a later host has not answered yet', results: { a: 'busy', b: 'busy' }, expected: undefined },
    { case: 'every host is busy', results: { a: 'busy', b: 'busy', c: 'busy' }, expected: 'a' },
    {
      case: 'a busy host follows one that did not answer',
      results: { a: 'no-answer', b: 'busy', c: 'no-answer' },
      expected: 'b',
    },
    {
      case: 'no host answered',
      results: { a: 'no-answer', b: 'no-answer', c: 'no-answer' },
      expected: 'a',
    },
  ])('chooses $expected when $case', ({ expected, results }) => {
    expect(selectHost(HOSTS, new Map(Object.entries(results)))).toBe(expected);
  });
});

describe(chooseHost, () => {
  it('chooses as soon as the results settle it, and aborts the probes still running', async () => {
    const signals = new Map<string, AbortSignal>();
    const settled: string[] = [];

    const chosen = await chooseHost({
      hosts: HOSTS,
      onSettled(host, result) {
        settled.push(`${host} ${result}`);
      },
      probe(host, signal) {
        signals.set(host, signal);
        // `c` never answers, so the choice must not wait for it.
        if (host === 'c') return new Promise(() => {});
        return Promise.resolve(host === 'a' ? 'busy' : 'free');
      },
    });

    expect(chosen).toBe('b');
    expect(settled).toStrictEqual(['a busy', 'b free']);
    expect(signals.get('c')?.aborted).toBe(true);
  });

  it('counts a probe that rejects as one that did not answer', async () => {
    const chosen = await chooseHost({
      hosts: ['a', 'b'],
      onSettled: () => {},
      probe: (host) => (host === 'a' ? Promise.reject(new Error('lost')) : Promise.resolve('busy')),
    });

    expect(chosen).toBe('b');
  });
});
