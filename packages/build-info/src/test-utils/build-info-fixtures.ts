import type { BuildInfo } from '../contract/types.ts';

/** Builds a `BuildInfo` in which every optional field is populated. */
export function buildFullBuildInfo(): BuildInfo {
  return {
    schemaVersion: 1,
    name: '@acme/web',
    version: '0.7.0',
    buildTime: '2026-10-08T06:29:41.123Z',
    host: 'vercel',
    environment: 'preview',
    commit: {
      sha: 'a59f2f8c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a',
      shortSha: 'a59f2f8',
      ref: 'main',
      message: 'Add the build label',
      author: 'Ada Lovelace',
      time: '2026-10-08T08:12:00+02:00',
      dirty: false,
    },
    repository: { provider: 'github', owner: 'acme', name: 'web', url: 'https://github.com/acme/web' },
    deployment: { id: 'dpl_123', url: 'https://web-abc.vercel.app', pullRequest: 42 },
    runtime: { node: '24.16.0' },
    releaseNotes: {
      date: '2026-10-08',
      markdown: '## Features\n\n- Add the build label\n',
      sections: [{ title: 'Features', items: [{ description: 'Add the build label', body: 'Shown in the footer.' }] }],
    },
  };
}

/** Builds a `BuildInfo` that contains only the required fields. */
export function buildMinimalBuildInfo(): BuildInfo {
  return {
    schemaVersion: 1,
    name: '@acme/web',
    version: '0.7.0',
    buildTime: '2026-10-08T06:29:41Z',
    host: 'local',
    environment: 'development',
  };
}
