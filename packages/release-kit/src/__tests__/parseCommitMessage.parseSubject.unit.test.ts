import { describe, expect, it } from 'vitest';

import { parseSubject } from '../parseCommitMessage.ts';
import { workTypes } from '../test-utils/workTypes.ts';

describe(parseSubject, () => {
  it.each(['#1 api|feat!: Redesign', '#1 feat(api)!: Redesign'])('reports the subject marker in "%s"', (subject) => {
    expect(parseSubject(subject, workTypes)).toStrictEqual({
      breaking: true,
      scope: 'api',
      title: 'Redesign',
      type: 'feat',
    });
  });

  it('ignores a `!:` later in the title', () => {
    expect(parseSubject('#1 fix: Handle field!: value notation', workTypes)?.breaking).toBeUndefined();
  });
});
