import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { STALE_AFTER_MS } from '../machine-lock.ts';
import { CHECKOUT_LOCK_PATH, type SessionRecord } from '../remote-host-session.ts';
import { composeSessionScript, createSessionDemultiplexer, formatDelegationWaitingLine } from '../remote-session.ts';

const MARKER = '__NMR_DELEGATE_abc__';

describe(composeSessionScript, () => {
  it('runs the host session with node from the checkout, passing its parameters as one quoted argument', () => {
    const script = composeSessionScript({
      checkoutDir: `"$HOME"/'repo'`,
      params: {
        holder: { command: 'test', dir: '/repo', pid: 1 },
        lockPath: CHECKOUT_LOCK_PATH,
        marker: MARKER,
        nmrArgs: ["it's"],
        passManifestDir: '.git/nmr-passes-test',
        passManifestEnvVar: 'NMR_PASS_MANIFEST_DIR',
        remoteEnv: {},
        rootDir: '.',
        runDir: '.',
        sha: 'abc123',
        staleAfterMs: STALE_AFTER_MS,
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

  it('passes on a passes record after the run, split across chunks, without forwarding it', () => {
    const { demux, malformed, records, stderr } = setUp();

    demux.stream.write(`${MARKER} {"kind":"run"}\nlast line\n${MARKER} {"kind":"pas`);
    expect(stderr.read()).toBe('last line\n');
    demux.stream.write(`ses","entries":[{"command":"test"}]}\n`);
    demux.flush();

    expect(records).toStrictEqual([{ kind: 'run' }, { kind: 'passes', entries: [{ command: 'test' }] }]);
    expect(stderr.read()).toBe('last line\n');
    expect(malformed).toStrictEqual([]);
  });

  it('passes on a passes record that follows output without a newline in the same chunk', () => {
    const { demux, records, stderr } = setUp();

    demux.stream.write(`${MARKER} {"kind":"run"}\n`);
    demux.stream.write(`no newline${MARKER} {"kind":"passes","entries":[]}\n`);
    demux.flush();

    expect(records).toStrictEqual([{ kind: 'run' }, { kind: 'passes', entries: [] }]);
    expect(stderr.read()).toBe('no newline');
  });

  it('discards a malformed passes record after the run', () => {
    const { demux, malformed, records, stderr } = setUp();

    demux.stream.write(`${MARKER} {"kind":"run"}\n${MARKER} {"kind":"passes","entries":"none"}\nafter\n`);

    expect(records).toStrictEqual([{ kind: 'run' }]);
    expect(malformed).toHaveLength(1);
    expect(stderr.read()).toBe('after\n');
  });

  it('forwards the run output byte for byte, a character and a line split across chunks included', () => {
    const { demux, stderr } = setUp();
    const output = Buffer.from('é ok\n__NMR_DELEGATE_ab not a record\n__NMR_DELEGATE_abc__x\nend', 'utf8');

    demux.stream.write(Buffer.from(`${MARKER} {"kind":"run"}\n`));
    // The cuts split `é`, then the second and third lines, each of which begins like a record.
    const cuts = [1, 2, 9, 22, 30, 41, 50];
    for (const [index, start] of [0, ...cuts].entries()) {
      demux.stream.write(output.subarray(start, cuts[index] ?? output.length));
    }
    demux.flush();

    expect(stderr.readBytes().equals(output)).toBe(true);
  });

  it('holds back only the trailing bytes that may still begin a record', () => {
    const { demux, stderr } = setUp();

    demux.stream.write(`${MARKER} {"kind":"run"}\nprogress 50%`);
    expect(stderr.read()).toBe('progress 50%');
    demux.stream.write('\nstep __NMR_DEL');
    expect(stderr.read()).toBe('progress 50%\nstep ');
    demux.stream.write('AY');
    expect(stderr.read()).toBe('progress 50%\nstep __NMR_DELAY');
    demux.stream.write(' __NMR_DEL');
    demux.flush();
    expect(stderr.read()).toBe('progress 50%\nstep __NMR_DELAY __NMR_DEL');
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
  const malformed: true[] = [];
  const demux = createSessionDemultiplexer({
    marker: MARKER,
    onMalformedRecord: () => {
      malformed.push(true);
    },
    onRecord: (record) => {
      records.push(record);
    },
    stderr: stream,
  });

  return {
    demux,
    malformed,
    records,
    stderr: { read: () => Buffer.concat(chunks).toString('utf8'), readBytes: () => Buffer.concat(chunks) },
  };
}

// endregion | Helpers
