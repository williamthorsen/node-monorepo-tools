import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import type { SessionRecord } from '../remote-host-session.ts';
import { composeSessionScript, createSessionDemultiplexer, formatDelegationWaitingLine } from '../remote-session.ts';

const MARKER = '__NMR_DELEGATE_abc__';

describe(composeSessionScript, () => {
  it('runs the host session with node from the checkout, passing its parameters as one quoted argument', () => {
    const script = composeSessionScript({
      checkoutDir: `"$HOME"/'repo'`,
      params: {
        holder: { command: 'test', dir: '/repo', pid: 1 },
        marker: MARKER,
        nmrArgs: ["it's"],
        remoteEnv: {},
        rootDir: '.',
        runDir: '.',
        sha: 'abc123',
        statusFile: '.git/nmr-run-status-abc',
      },
    });

    expect(script).toMatch(/^cd "\$HOME"\/'repo' && exec node -e '\(function runHostSession\(/);
    expect(script).toContain(String.raw`"nmrArgs":["it'\''s"]`);
  });
});

describe(createSessionDemultiplexer, () => {
  it('passes records on, keeps other text as output, and forwards everything after the run record raw', () => {
    const { records, stderr, demux } = setUp();

    demux.stream.write(
      `${MARKER} {"kind":"waiting","holder":{"command":"ci","dir":"/r","pid":7}}\nstray\n${MARKER} {"kind":"lo`,
    );
    demux.stream.write(`cked"}\n${MARKER} {"kind":"run"}\nfirst `);
    demux.stream.write(`${MARKER} {"kind":"failed"}\n`);

    expect(records).toStrictEqual([
      { kind: 'waiting', holder: { command: 'ci', dir: '/r', pid: 7 } },
      { kind: 'locked' },
      { kind: 'run' },
    ]);
    expect(demux.hasStarted()).toBe(true);
    expect(demux.readOutput()).toBe('stray\n');
    expect(stderr.read()).toBe(`first ${MARKER} {"kind":"failed"}\n`);
  });

  it('treats a line with another marker, or one that is not a record, as output', () => {
    const { records, demux } = setUp();

    demux.stream.write(`__NMR_DELEGATE_forged__ {"kind":"run"}\n${MARKER} {"kind":"bogus"}\n${MARKER} not json\n`);
    demux.stream.write('partial');

    expect(records).toStrictEqual([]);
    expect(demux.hasStarted()).toBe(false);
    expect(demux.readOutput()).toBe(
      `__NMR_DELEGATE_forged__ {"kind":"run"}\n${MARKER} {"kind":"bogus"}\n${MARKER} not json\npartial`,
    );
  });

  it('parses a failed record', () => {
    const { records, demux } = setUp();

    demux.stream.write(`${MARKER} {"kind":"failed","exitCode":1,"output":"boom","phase":"install"}\n`);

    expect(records).toStrictEqual([{ kind: 'failed', exitCode: 1, output: 'boom', phase: 'install' }]);
  });
});

describe(formatDelegationWaitingLine, () => {
  it("names the holder's command, directory, and pid, and the host", () => {
    expect(formatDelegationWaitingLine({ command: 'ci', dir: '/repo', pid: 41_872 }, 'imac2')).toBe(
      'nmr: waiting for ci in /repo (pid 41872) to finish on imac2',
    );
  });

  it('names the host alone when the lock file does not name a holder', () => {
    expect(formatDelegationWaitingLine(undefined, 'imac2')).toBe(
      "nmr: waiting for another delegation's checkout on imac2",
    );
  });
});

// region | Helpers

/** Creates a demultiplexer that records what it passes on and writes the run's output to a captured stream. */
function setUp() {
  const records: SessionRecord[] = [];
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });
  const demux = createSessionDemultiplexer({
    marker: MARKER,
    onRecord: (record) => {
      records.push(record);
    },
    stderr: stream,
  });

  return { demux, records, stderr: { read: () => Buffer.concat(chunks).toString('utf8') } };
}

// endregion | Helpers
