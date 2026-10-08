import { describe, expect, it } from 'vitest';

import { buildFullBuildInfo, buildMinimalBuildInfo } from '../../test-utils/build-info-fixtures.ts';
import { InvalidBuildInfoError } from '../InvalidBuildInfoError.ts';
import { isBuildInfo, parseBuildInfo } from '../parse.ts';

describe('parseBuildInfo', () => {
  it('accepts a parsed object', () => {
    const info = buildFullBuildInfo();

    expect(parseBuildInfo(info)).toStrictEqual(info);
  });

  it('accepts a JSON string', () => {
    const info = buildFullBuildInfo();

    expect(parseBuildInfo(JSON.stringify(info))).toStrictEqual(info);
  });

  it('accepts a value without any optional field', () => {
    const info = buildMinimalBuildInfo();

    expect(parseBuildInfo(info)).toStrictEqual(info);
  });

  it('accepts a custom environment name', () => {
    expect(parseBuildInfo({ ...buildMinimalBuildInfo(), environment: 'staging' }).environment).toBe('staging');
  });

  it('treats an undefined optional field as omitted', () => {
    expect(parseBuildInfo({ ...buildMinimalBuildInfo(), commit: undefined })).not.toHaveProperty('commit');
  });

  it('drops unknown keys at every level', () => {
    const info = buildFullBuildInfo();
    const extended = {
      ...info,
      extra: true,
      commit: { ...info.commit, extra: true },
      repository: { ...info.repository, extra: true },
      deployment: { ...info.deployment, extra: true },
      runtime: { ...info.runtime, extra: true },
      releaseNotes: {
        ...info.releaseNotes,
        extra: true,
        sections: [{ title: 'Features', extra: true, items: [{ description: 'Add the build label', extra: true }] }],
      },
    };

    expect(parseBuildInfo(extended)).toStrictEqual({
      ...info,
      releaseNotes: {
        ...info.releaseNotes,
        sections: [{ title: 'Features', items: [{ description: 'Add the build label' }] }],
      },
    });
  });

  it('returns the keys in the contract order', () => {
    const { environment, host, buildTime, version, name, schemaVersion } = buildMinimalBuildInfo();
    const reordered = { environment, host, buildTime, version, name, schemaVersion };

    expect(Object.keys(parseBuildInfo(reordered))).toStrictEqual([
      'schemaVersion',
      'name',
      'version',
      'buildTime',
      'host',
      'environment',
    ]);
  });

  it.each<[description: string, value: unknown, path: string]>([
    ['a value that is not an object', [], ''],
    ['a missing required field', omitKey(buildMinimalBuildInfo(), 'version'), 'version'],
    ['a schemaVersion other than 1', { ...buildMinimalBuildInfo(), schemaVersion: 2 }, 'schemaVersion'],
    ['a buildTime with an offset', { ...buildMinimalBuildInfo(), buildTime: '2026-10-08T06:29:41+02:00' }, 'buildTime'],
    ['a buildTime without a time', { ...buildMinimalBuildInfo(), buildTime: '2026-10-08' }, 'buildTime'],
    [
      'a buildTime on an impossible day',
      { ...buildMinimalBuildInfo(), buildTime: '2026-02-30T00:00:00Z' },
      'buildTime',
    ],
    ['a host outside the union', { ...buildMinimalBuildInfo(), host: 'netlify' }, 'host'],
    ['an empty name', { ...buildMinimalBuildInfo(), name: '' }, 'name'],
    ['an empty version', { ...buildMinimalBuildInfo(), version: '' }, 'version'],
    ['an empty environment', { ...buildMinimalBuildInfo(), environment: '' }, 'environment'],
    ['a null optional field', { ...buildMinimalBuildInfo(), commit: null }, 'commit'],
    [
      'a wrong-typed optional field',
      { ...buildFullBuildInfo(), deployment: { pullRequest: '42' } },
      'deployment.pullRequest',
    ],
    ['a missing nested required field', { ...buildMinimalBuildInfo(), commit: { sha: 'a59f2f8' } }, 'commit.shortSha'],
    [
      'a wrong-typed commit flag',
      { ...buildMinimalBuildInfo(), commit: { sha: 'a', shortSha: 'a', dirty: 'yes' } },
      'commit.dirty',
    ],
    ['a missing runtime version', { ...buildMinimalBuildInfo(), runtime: {} }, 'runtime.node'],
    [
      'a repository without a URL',
      { ...buildMinimalBuildInfo(), repository: { provider: 'github', owner: 'a', name: 'b' } },
      'repository.url',
    ],
    [
      'sections that are not an array',
      { ...buildMinimalBuildInfo(), releaseNotes: { markdown: '', sections: {} } },
      'releaseNotes.sections',
    ],
    [
      'an invalid release-note item',
      {
        ...buildMinimalBuildInfo(),
        releaseNotes: { markdown: '', sections: [{ title: 'Fixes', items: [{ description: 'a' }, {}] }] },
      },
      'releaseNotes.sections[0].items[1].description',
    ],
  ])('rejects %s', (_description, value, path) => {
    expect(() => parseBuildInfo(value)).toThrow(expect.objectContaining({ name: 'InvalidBuildInfoError', path }));
  });

  it('rejects a string that is not JSON, keeping the syntax error as the cause', () => {
    const error = captureError(() => parseBuildInfo('{ not json'));

    expect(error).toBeInstanceOf(InvalidBuildInfoError);
    expect(error).toMatchObject({ path: '', message: 'value: expected a JSON string' });
    expect(error).toHaveProperty('cause', expect.any(SyntaxError));
  });

  it('names the invalid field in the message', () => {
    expect(() => parseBuildInfo({ ...buildMinimalBuildInfo(), commit: { sha: 1 } })).toThrow(
      'commit.sha: expected a string',
    );
  });
});

describe('isBuildInfo', () => {
  it('returns true for a valid object that has unknown keys', () => {
    expect(isBuildInfo({ ...buildFullBuildInfo(), extra: true })).toBe(true);
  });

  it('returns false for a JSON string, even a valid one', () => {
    expect(isBuildInfo(JSON.stringify(buildFullBuildInfo()))).toBe(false);
  });

  it.each<[description: string, value: unknown]>([
    ['undefined', undefined],
    ['null', null],
    ['an object missing a required field', omitKey(buildMinimalBuildInfo(), 'name')],
    ['an object with an invalid nested field', { ...buildMinimalBuildInfo(), runtime: { node: 24 } }],
  ])('returns false for %s', (_description, value) => {
    expect(isBuildInfo(value)).toBe(false);
  });
});

// region | Helpers

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected the action to throw');
}

function omitKey(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([candidate]) => candidate !== key));
}

// endregion | Helpers
