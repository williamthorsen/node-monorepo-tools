import { describe, expect, it } from 'vitest';

import { buildFullBuildInfo, buildMinimalBuildInfo } from '../../test-utils/build-info-fixtures.ts';
import { formatBuildLabel, getBuildLabelParts, getCommitUrl } from '../format.ts';

describe(formatBuildLabel, () => {
  it('formats the version, short SHA, and build time truncated to the minute', () => {
    expect(formatBuildLabel(buildFullBuildInfo())).toBe('v0.7.0 · a59f2f8 · 2026-10-08 06:29Z');
  });

  it('omits the commit segment when the build does not record a commit', () => {
    expect(formatBuildLabel(buildMinimalBuildInfo())).toBe('v0.7.0 · 2026-10-08 06:29Z');
  });

  it('does not double a leading v', () => {
    expect(formatBuildLabel({ ...buildMinimalBuildInfo(), version: 'v0.7.0' })).toBe('v0.7.0 · 2026-10-08 06:29Z');
  });
});

describe(getBuildLabelParts, () => {
  it('returns the version, short SHA, and minute-truncated build time', () => {
    expect(getBuildLabelParts(buildFullBuildInfo())).toStrictEqual({
      version: 'v0.7.0',
      shortSha: 'a59f2f8',
      time: '2026-10-08 06:29Z',
    });
  });

  it('omits the short SHA when the build does not record a commit', () => {
    expect(getBuildLabelParts(buildMinimalBuildInfo())).toStrictEqual({ version: 'v0.7.0', time: '2026-10-08 06:29Z' });
  });
});

describe(getCommitUrl, () => {
  it('returns the commit URL on GitHub', () => {
    expect(getCommitUrl(buildFullBuildInfo())).toBe(
      'https://github.com/acme/web/commit/a59f2f8c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a',
    );
  });

  it('ignores a trailing slash on the repository URL', () => {
    const info = buildFullBuildInfo();
    const repository = { provider: 'github', owner: 'acme', name: 'web', url: 'https://github.com/acme/web/' };

    expect(getCommitUrl({ ...info, repository })).toBe(
      'https://github.com/acme/web/commit/a59f2f8c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a',
    );
  });

  it('returns undefined for a provider other than GitHub', () => {
    const info = buildFullBuildInfo();
    const repository = { provider: 'gitlab', owner: 'acme', name: 'web', url: 'https://gitlab.com/acme/web' };

    expect(getCommitUrl({ ...info, repository })).toBeUndefined();
  });

  it('returns undefined without a repository', () => {
    const { repository: _repository, ...info } = buildFullBuildInfo();

    expect(getCommitUrl(info)).toBeUndefined();
  });

  it('returns undefined without a commit', () => {
    const { commit: _commit, ...info } = buildFullBuildInfo();

    expect(getCommitUrl(info)).toBeUndefined();
  });
});
