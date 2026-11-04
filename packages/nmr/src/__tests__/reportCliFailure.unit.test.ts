import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { reportCliFailure } from '../reportCliFailure.ts';
import { UserError } from '../UserError.ts';

describe(reportCliFailure, () => {
  it('reports a user error as its message alone', () => {
    const writtenReport = reportToString(new UserError('Invalid nmr config at /repo/.config/nmr.config.ts: nope'));

    expect(writtenReport).toBe('Error: Invalid nmr config at /repo/.config/nmr.config.ts: nope\n');
  });

  it('reports nmr’s own fault as an internal error, with the stack from which a report of one starts', () => {
    const writtenReport = reportToString(new Error('unhandled script origin'));

    expect(writtenReport).toMatch(/^nmr: internal error: unhandled script origin\n {4}at /);
  });

  it('reports a thrown non-Error as an internal error without a stack', () => {
    const writtenReport = reportToString('just a string');

    expect(writtenReport).toBe('nmr: internal error: just a string\n');
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
