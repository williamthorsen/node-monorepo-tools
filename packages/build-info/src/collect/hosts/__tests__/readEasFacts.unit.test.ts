import { describe, expect, it } from 'vitest';

import { readEasFacts } from '../readEasFacts.ts';

describe(readEasFacts, () => {
  it('returns undefined outside EAS Build', () => {
    expect(readEasFacts({})).toBeUndefined();
    expect(readEasFacts({ EAS_BUILD: '1' })).toBeUndefined();
  });

  it('maps every EAS variable', () => {
    expect(
      readEasFacts({
        EAS_BUILD: 'true',
        EAS_BUILD_PROFILE: 'production',
        EAS_BUILD_GIT_COMMIT_HASH: 'abc1234def',
        EAS_BUILD_ID: 'build-123',
      }),
    ).toStrictEqual({
      host: 'eas',
      environment: 'production',
      commit: { sha: 'abc1234def' },
      deployment: { id: 'build-123' },
    });
  });

  it('omits every field whose variables are empty', () => {
    expect(readEasFacts({ EAS_BUILD: 'true', EAS_BUILD_PROFILE: '' })).toStrictEqual({ host: 'eas' });
  });
});
