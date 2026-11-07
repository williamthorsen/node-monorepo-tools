import { describe, expect, it } from 'vitest';

import { formatFlagSpelling, formatShortSpelling, readInvocationFlags } from '../nmr-flags.ts';

describe(readInvocationFlags, () => {
  it('reads each flag, the command, and the arguments after it', () => {
    const reading = readInvocationFlags([
      '-F',
      'pkg',
      '-q',
      '--json',
      '--no-cache',
      '--output-style=plain',
      'test',
      '--watch',
    ]);

    expect(reading).toStrictEqual({
      ok: true,
      parsedArgs: {
        command: 'test',
        filter: 'pkg',
        isWorkspaceRoot: false,
        outputStyle: 'plain',
        passthrough: ['--watch'],
        quiet: true,
        recursive: false,
        shouldBypassCache: true,
        shouldBypassLock: false,
        shouldDelegate: false,
        shouldEmitJson: true,
        shouldPrintLog: false,
        shouldRunLocally: false,
        shouldShowHelp: false,
        shouldShowVersion: false,
      },
    });
  });

  it.for([
    { args: ['--output-style', 'plain', 'build'], label: 'a separate value' },
    { args: ['--delegate-to', 'box', 'build'], label: 'a host list' },
    { args: ['--filter=x', 'build'], label: 'an assigned value' },
  ])('does not take $label for the command', ({ args }) => {
    const reading = readInvocationFlags(args);

    expect(reading.ok && reading.parsedArgs.command).toBe('build');
  });

  it('reads the help and version flags that the router reserves', () => {
    const reading = readInvocationFlags(['-w', '-h', '--help', '-V']);

    expect(reading.ok && [reading.parsedArgs.shouldShowHelp, reading.parsedArgs.shouldShowVersion]).toStrictEqual([
      true,
      true,
    ]);
    expect(reading.ok && reading.parsedArgs.isWorkspaceRoot).toBe(true);
  });

  it.for([['-wh'], ['-hw'], ['-qwh', 'build']])('reads a help flag clustered with other flags in %j', (args) => {
    const reading = readInvocationFlags(args);

    expect(reading.ok && [reading.parsedArgs.shouldShowHelp, reading.parsedArgs.isWorkspaceRoot]).toStrictEqual([
      true,
      true,
    ]);
  });

  it('does not take a filter value that contains h for a help cluster', () => {
    expect(readInvocationFlags(['-F', '-hw'])).toStrictEqual({ ok: false });
  });

  it('stops at the command, leaving a flag after it to the command', () => {
    const reading = readInvocationFlags(['build', '-q']);

    expect(reading.ok && [reading.parsedArgs.quiet, reading.parsedArgs.passthrough]).toStrictEqual([false, ['-q']]);
  });

  it('does not read a terminator as the command', () => {
    const reading = readInvocationFlags(['--', 'build']);

    expect(reading.ok && reading.parsedArgs.command).toBeUndefined();
  });

  it.for([['-?'], ['-F', ''], ['--delegate=box'], ['--output-style']])(
    'reports flags that do not parse in %j without throwing',
    (args) => {
      expect(readInvocationFlags(args)).toStrictEqual({ ok: false });
    },
  );
});

describe(formatFlagSpelling, () => {
  it('spells a flag as the router derives its long name', () => {
    expect([formatFlagSpelling('noCache'), formatFlagSpelling('delegateTo')]).toStrictEqual([
      '--no-cache',
      '--delegate-to',
    ]);
  });
});

describe(formatShortSpelling, () => {
  it('spells the short form, or reports that a flag does not have one', () => {
    expect([formatShortSpelling('filter'), formatShortSpelling('json')]).toStrictEqual(['-F', undefined]);
  });
});
