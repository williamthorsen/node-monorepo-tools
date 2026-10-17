import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { resolveChannel, resolveInheritedChannel } from '../output-channel.ts';
import { createRedirectedStream, createTerminalStream } from '../test-utils/fake-spawn.ts';

describe(resolveChannel, () => {
  it.each([
    { channel: 1, isQuiet: false, scenario: 'a terminal destination in loud mode', useTerminal: true },
    { channel: 'pipe', isQuiet: false, scenario: 'a piped destination in loud mode', useTerminal: false },
    { channel: 'pipe', isQuiet: true, scenario: 'a terminal destination in quiet mode', useTerminal: true },
    { channel: 'pipe', isQuiet: true, scenario: 'a piped destination in quiet mode', useTerminal: false },
  ])('given $scenario, resolves to $channel', ({ channel, isQuiet, useTerminal }) => {
    const destination = useTerminal ? createTerminalStream() : new PassThrough();

    expect(resolveChannel(destination, isQuiet)).toBe(channel);
  });
});

describe(resolveInheritedChannel, () => {
  it.each([
    { channel: 1, scenario: 'a terminal destination', createStream: createTerminalStream },
    { channel: 1, scenario: 'a destination redirected to a file', createStream: createRedirectedStream },
    { channel: 'pipe', scenario: 'a destination without a descriptor', createStream: () => new PassThrough() },
  ])('given $scenario, resolves to $channel', ({ channel, createStream }) => {
    expect(resolveInheritedChannel(createStream())).toBe(channel);
  });
});
