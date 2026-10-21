import { describe, expect, it } from 'vitest';

import { chooseHost, type HostSelection, type ProbeReport, type ProbeResult, selectHost } from '../remote-probe.ts';
import type { HostList } from '../remote-run.ts';

const HOSTS: HostList = ['a', 'b', 'c'];

describe(selectHost, () => {
  it.for<{ case: string; expected: HostSelection | undefined; results: Record<string, ProbeResult> }>([
    { case: 'the first host is free', results: { a: 'free' }, expected: chosen('a') },
    {
      case: 'an earlier host is busy and a later one is free',
      results: { a: 'busy', b: 'free' },
      expected: chosen('b'),
    },
    { case: 'an earlier host has not answered yet', results: { b: 'free', c: 'free' }, expected: undefined },
    { case: 'a later host has not answered yet', results: { a: 'busy', b: 'busy' }, expected: undefined },
    { case: 'every host is busy', results: { a: 'busy', b: 'busy', c: 'busy' }, expected: chosen('a') },
    {
      case: 'a busy host follows one that did not answer',
      results: { a: 'no-answer', b: 'busy', c: 'no-answer' },
      expected: chosen('b'),
    },
    {
      case: 'a busy host follows one that could not be reached',
      results: { a: 'unreachable', b: 'busy', c: 'unreachable' },
      expected: chosen('b'),
    },
    {
      case: 'no host answered',
      results: { a: 'no-answer', b: 'no-answer', c: 'no-answer' },
      expected: chosen('a'),
    },
    {
      case: 'a host that did not answer follows one that could not be reached',
      results: { a: 'unreachable', b: 'no-answer', c: 'unreachable' },
      expected: chosen('b'),
    },
    {
      case: 'no host could be reached',
      results: { a: 'unreachable', b: 'unreachable', c: 'unreachable' },
      expected: { kind: 'unreachable' },
    },
  ])('selects $expected when $case', ({ expected, results }) => {
    expect(selectHost(HOSTS, new Map(Object.entries(results)))).toStrictEqual(expected);
  });
});

describe(chooseHost, () => {
  it('chooses as soon as the results settle it, and aborts the probes still running', async () => {
    const signals = new Map<string, AbortSignal>();
    const settled: string[] = [];

    const choice = await chooseHost({
      hosts: HOSTS,
      onSettled(host, result) {
        settled.push(`${host} ${result}`);
      },
      probe(host, signal) {
        signals.set(host, signal);
        // `c` never answers, so the choice must not wait for it.
        if (host === 'c') return new Promise(() => {});
        return Promise.resolve(report(host === 'a' ? 'busy' : 'free'));
      },
    });

    expect(choice).toStrictEqual({ kind: 'chosen', host: 'b' });
    expect(settled).toStrictEqual(['a busy', 'b free']);
    expect(signals.get('c')?.aborted).toBe(true);
  });

  it('counts a probe that rejects as one that did not answer', async () => {
    const choice = await chooseHost({
      hosts: ['a', 'b'],
      onSettled: () => {},
      probe: (host) => (host === 'a' ? Promise.reject(new Error('lost')) : Promise.resolve(report('unreachable'))),
    });

    expect(choice).toStrictEqual({ kind: 'chosen', host: 'a' });
  });

  it('reports what ssh printed for the first host when no host could be reached', async () => {
    const choice = await chooseHost({
      hosts: ['a', 'b'],
      onSettled: () => {},
      probe: (host) => Promise.resolve({ result: 'unreachable', sshMessage: `no route to ${host}` }),
    });

    expect(choice).toStrictEqual({ kind: 'unreachable', host: 'a', sshMessage: 'no route to a' });
  });
});

// region | Helpers

/** Returns the selection of `host`. */
function chosen(host: string): HostSelection {
  return { kind: 'chosen', host };
}

/** Returns a probe report without an ssh message. */
function report(result: ProbeResult): ProbeReport {
  return { result, sshMessage: '' };
}

// endregion | Helpers
