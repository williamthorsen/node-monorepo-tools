import { join } from 'node:path';

import { UserError } from '@williamthorsen/nmr-core';
import { captureError, createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it } from 'vitest';

import { readJsonFile } from '../readJsonFile.ts';

describe(readJsonFile, () => {
  it('returns the parsed content of a JSON file', () => {
    const tree = disposeOnTestFinished(createTempTree({ 'data.json': '{ "name": "a", "items": [1, 2] }' }));

    expect(readJsonFile(join(tree.dir, 'data.json'))).toStrictEqual({ name: 'a', items: [1, 2] });
  });

  it('throws a read failure that names the file and keeps the cause', async () => {
    const tree = disposeOnTestFinished(createTempTree({}));
    const filePath = join(tree.dir, 'missing.json');

    const error = await captureError(UserError, () => readJsonFile(filePath));

    expect(error.message).toMatch(new RegExp(`^Failed to read ${RegExp.escape(filePath)}: ENOENT`));
    expect(error.cause).toHaveProperty('code', 'ENOENT');
  });

  it('throws a parse failure that names the file and keeps the cause', async () => {
    const tree = disposeOnTestFinished(createTempTree({ 'broken.json': '{ not valid json' }));
    const filePath = join(tree.dir, 'broken.json');

    const error = await captureError(UserError, () => readJsonFile(filePath));

    expect(error.message).toMatch(new RegExp(`^Failed to parse JSON in ${RegExp.escape(filePath)}: `));
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });
});
