import type { Writable } from 'node:stream';

/** Where one of a child's output streams goes: a descriptor to which the child writes, or a pipe read by nmr. */
export type OutputChannel = number | 'pipe';

/** The channel on which each of a child's output streams runs. */
export interface OutputChannels {
  stderr: OutputChannel;
  stdout: OutputChannel;
}

/** Narrows a stream to one backed by a terminal, whose descriptor the child can be handed. */
export function isTerminal(stream: Writable): stream is Writable & { fd: number } {
  return 'isTTY' in stream && stream.isTTY === true && hasDescriptor(stream);
}

/**
 * Returns the channel on which a stream runs: the stream's own descriptor when it is a terminal and output is
 * not being withheld, so that the child's terminal detection matches nmr's, and a pipe everywhere else.
 */
export function resolveChannel(stream: Writable, quiet: boolean): OutputChannel {
  if (quiet) return 'pipe';
  return isTerminal(stream) ? stream.fd : 'pipe';
}

/**
 * Returns the channel for a step that runs an nmr process below this one: nmr's own descriptor whenever it has
 * one, so that the child writes where nmr writes, without an ancestor between them relaying bytes. A stream
 * without a descriptor falls back to a pipe.
 */
export function resolveInheritedChannel(stream: Writable): OutputChannel {
  return hasDescriptor(stream) ? stream.fd : 'pipe';
}

// region | Helpers

/** Narrows a stream to one with a descriptor that a child can be handed, terminal or not. */
function hasDescriptor(stream: Writable): stream is Writable & { fd: number } {
  return 'fd' in stream && typeof stream.fd === 'number';
}

// endregion | Helpers
