import { PassThrough } from 'node:stream';
import { WriteStream } from 'node:tty';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bold, dim, sectionHeader } from '../format.ts';

const ESCAPE = '\u{1B}';

/** Stream states for which no escapes are emitted. */
const PLAIN_STATES = [
  { name: 'returns the text unstyled for a pipe', createStream: createPipe, env: {} },
  {
    name: 'returns the text unstyled for a terminal when NO_COLOR is set',
    createStream: createColorTerminal,
    env: { NO_COLOR: '1' },
  },
];

/** Stream states for which escapes are emitted. */
const STYLED_STATES = [
  { name: 'styles the text for a color-capable terminal', createStream: createColorTerminal, env: {} },
  { name: 'styles the text for a pipe when FORCE_COLOR is set', createStream: createPipe, env: { FORCE_COLOR: '1' } },
];

describe('color-aware styling', () => {
  beforeEach(() => {
    // Node derives color support from the ambient environment, so each state under test sets it explicitly.
    vi.stubEnv('FORCE_COLOR', undefined);
    vi.stubEnv('NODE_DISABLE_COLORS', undefined);
    vi.stubEnv('NO_COLOR', undefined);
    vi.stubEnv('TERM', 'xterm-256color');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe(bold, () => {
    it.each(PLAIN_STATES)('$name', ({ createStream, env }) => {
      stubEnv(env);

      expect(bold('hello', createStream())).toBe('hello');
    });

    it.each(STYLED_STATES)('$name', ({ createStream, env }) => {
      stubEnv(env);

      const styled = bold('hello', createStream());

      expect(styled).toContain(ESCAPE);
      expect(styled).toContain('hello');
    });
  });

  describe(dim, () => {
    it.each(PLAIN_STATES)('$name', ({ createStream, env }) => {
      stubEnv(env);

      expect(dim('hello', createStream())).toBe('hello');
    });

    it.each(STYLED_STATES)('$name', ({ createStream, env }) => {
      stubEnv(env);

      const styled = dim('hello', createStream());

      expect(styled).toContain(ESCAPE);
      expect(styled).toContain('hello');
    });

    it('styles the text differently from bold', () => {
      const terminal = createColorTerminal();

      expect(dim('hello', terminal)).not.toBe(bold('hello', terminal));
    });
  });
});

describe(sectionHeader, () => {
  it('wraps the name in box-drawing rules', () => {
    expect(sectionHeader('release-kit')).toBe('━━━ release-kit ━━━');
  });

  it('handles a short name', () => {
    expect(sectionHeader('a')).toBe('━━━ a ━━━');
  });
});

// region | Helpers

/**
 * Creates a stream that renders color.
 *
 * The color depth comes from Node's own implementation rather than a fixed number, because Node consults
 * `NO_COLOR` inside `getColorDepth`; a fixed depth would report color however the environment is set.
 */
function createColorTerminal(): NodeJS.WritableStream {
  const stream = new PassThrough();

  return Object.assign(stream, { isTTY: true, getColorDepth: () => WriteStream.prototype.getColorDepth.call(stream) });
}

/** Creates a stream that renders no color, standing in for a pipe or a redirect to a file. */
function createPipe(): NodeJS.WritableStream {
  return new PassThrough();
}

/** Applies a state's environment settings for the remainder of the test. */
function stubEnv(env: Record<string, string>): void {
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }
}

// endregion | Helpers
