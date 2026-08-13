import { describe, expect, it } from 'vitest';

import { cleanTranscript, composeTranscript, TRANSCRIPT_LIMIT_BYTES } from '../transcript.ts';

/** An empty capture, which a command writing to one stream alone hands back for the other. */
const NOTHING = Buffer.alloc(0);

describe(cleanTranscript, () => {
  it('strips the control sequences a command colors its output with', () => {
    expect(cleanTranscript('\u{1B}[32m✓ passed\u{1B}[39m')).toBe('✓ passed');
  });

  it('strips an operating-system command, such as the one wrapping a hyperlink', () => {
    expect(cleanTranscript('\u{1B}]8;;https://example.com\u{7}report\u{1B}]8;;\u{7}')).toBe('report');
  });

  it('reduces a redrawn line to the segment a reader was left looking at', () => {
    expect(cleanTranscript('12 / 40\r28 / 40\r40 / 40')).toBe('40 / 40');
  });

  it('leaves a line carrying neither untouched', () => {
    expect(cleanTranscript('Test Files  6 passed (6)\n')).toBe('Test Files  6 passed (6)\n');
  });
});

describe(composeTranscript, () => {
  it('given a command that wrote nothing, returns undefined', () => {
    expect(composeTranscript({ stdout: NOTHING, stderr: Buffer.from('  \n') })).toBeUndefined();
  });

  it('given one stream carrying content, returns it alone and names no stream', () => {
    const composed = composeTranscript({ stdout: Buffer.from('all files pass\n'), stderr: NOTHING });

    expect(composed).toBe('all files pass\n');
  });

  it('given both streams carrying content, follows stdout with stderr, naming where it begins', () => {
    const composed = composeTranscript({ stdout: Buffer.from('ran 6 files\n'), stderr: Buffer.from('1 warning\n') });

    expect(composed).toBe('ran 6 files\n\n… nmr: stderr …\n1 warning\n');
  });

  it('cleans what it composes', () => {
    const composed = composeTranscript({ stdout: Buffer.from('\u{1B}[32m✓ passed\u{1B}[39m'), stderr: NOTHING });

    expect(composed).toBe('✓ passed');
  });

  describe('a transcript overrunning the ceiling', () => {
    const OVERRUN_BYTES = TRANSCRIPT_LIMIT_BYTES + 10_000;

    /** Distinguishable ends around a filler middle, so a cut that kept the wrong end is visible. */
    function composeOverrun(): string {
      const filler = 'x'.repeat(OVERRUN_BYTES - 'HEAD'.length - 'TAIL'.length);

      const composed = composeTranscript({ stdout: Buffer.from(`HEAD${filler}TAIL`), stderr: NOTHING });
      if (composed === undefined) throw new Error('the fixture composed nothing');

      return composed;
    }

    it('keeps both ends', () => {
      const composed = composeOverrun();

      expect(composed.startsWith('HEAD')).toBe(true);
      expect(composed.endsWith('TAIL')).toBe(true);
    });

    it('marks what it dropped rather than cutting silently', () => {
      expect(composeOverrun()).toContain('… nmr elided 10,000 bytes …');
    });

    it('leaves what it keeps within the ceiling, the marker aside', () => {
      expect(Buffer.byteLength(composeOverrun())).toBeLessThan(TRANSCRIPT_LIMIT_BYTES + 100);
    });

    // A cut landing mid-character would store a replacement character in place of the pair it split.
    it('cuts between characters, never inside one', () => {
      const filler = '✓'.repeat(Math.ceil(OVERRUN_BYTES / Buffer.byteLength('✓')));

      const composed = composeTranscript({ stdout: Buffer.from(filler), stderr: NOTHING });

      expect(composed).not.toContain('�');
    });
  });
});
