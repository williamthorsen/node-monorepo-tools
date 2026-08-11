import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { reportCliFailure } from '../reportCliFailure.ts';
import { UserError } from '../UserError.ts';

describe(reportCliFailure, () => {
  it('reports a user error as its message alone', () => {
    const written = reportToString(new UserError('Invalid nmr config at /repo/.config/nmr.config.ts: nope'));

    expect(written).toBe('Error: Invalid nmr config at /repo/.config/nmr.config.ts: nope\n');
  });

  it('reports nmr’s own fault with the stack a report of one starts from', () => {
    const written = reportToString(new Error('unhandled script origin'));

    expect(written).toContain('unhandled script origin');
    expect(written).toContain('    at ');
  });

  it('describes a thrown non-Error, which carries no stack to report', () => {
    const written = reportToString('just a string');

    expect(written).toBe('just a string\n');
  });
});

// region | Helpers

/** Runs the reporter against a collecting stream and returns everything it wrote. */
function reportToString(error: unknown): string {
  const chunks: Buffer[] = [];
  const stream = new PassThrough();
  stream.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  reportCliFailure(error, stream);

  return Buffer.concat(chunks).toString('utf8');
}

// endregion | Helpers
