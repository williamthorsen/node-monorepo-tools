/** The hosts whose builds the contract recognizes. */
export const BUILD_HOSTS = ['vercel', 'eas', 'github-actions', 'local', 'unknown'] as const;

/** The deployment environment: one of the three conventional names, or a custom one. */
export type BuildEnvironment = 'production' | 'preview' | 'development' | (string & {});

export type BuildHost = (typeof BUILD_HOSTS)[number];

/** The report of which build an app is. */
export interface BuildInfo {
  schemaVersion: 1;
  name: string;
  version: string;
  /** ISO 8601 in UTC, such as `2026-10-08T06:29:41Z`. */
  buildTime: string;
  host: BuildHost;
  environment: BuildEnvironment;
  commit?: BuildInfoCommit;
  repository?: BuildInfoRepository;
  deployment?: BuildInfoDeployment;
  runtime?: BuildInfoRuntime;
  releaseNotes?: BuildInfoReleaseNotes;
}

export interface BuildInfoCommit {
  sha: string;
  shortSha: string;
  ref?: string;
  /** The subject line of the commit message. */
  message?: string;
  author?: string;
  time?: string;
  /** Whether the working tree had uncommitted changes when the build ran. */
  dirty?: boolean;
}

export interface BuildInfoDeployment {
  id?: string;
  url?: string;
  pullRequest?: number;
}

export interface BuildInfoReleaseNotes {
  date?: string;
  markdown: string;
  sections?: BuildInfoReleaseNotesSection[];
}

export interface BuildInfoReleaseNotesItem {
  description: string;
  body?: string;
}

export interface BuildInfoReleaseNotesSection {
  title: string;
  items: BuildInfoReleaseNotesItem[];
}

export interface BuildInfoRepository {
  provider: 'github' | (string & {});
  owner: string;
  name: string;
  url: string;
}

export interface BuildInfoRuntime {
  /** The Node.js version that ran the build. */
  node: string;
}
