/** The hosts whose builds the contract recognizes. */
export const BUILD_HOSTS = ['vercel', 'eas', 'github-actions', 'local', 'unknown'] as const;

export type BuildHost = (typeof BUILD_HOSTS)[number];

/** The report of which build an app is. */
export interface BuildInfo {
  schemaVersion: 1;
  name: string;
  version: string;
  /** ISO 8601 in UTC, such as `2026-10-08T06:29:41Z`. */
  buildTime: string;
  host: BuildHost;
  /** The deployment environment: conventionally `production`, `preview`, or `development`, or a custom name. */
  environment: string;
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
  /** The hosting service, such as `github`. */
  provider: string;
  owner: string;
  name: string;
  url: string;
}

export interface BuildInfoRuntime {
  /** The Node.js version that ran the build. */
  node: string;
}
