import type { RawCommit, ReleaseWindow } from '../enumerateReleaseWindows.ts';
import type { ChangelogJsonConfig, ReleaseSettings } from '../types.ts';

const defaultChangelogJsonConfig: ChangelogJsonConfig = {
  enabled: true,
  outputPath: '.meta/changelog.json',
  devOnlySections: ['CI', 'Dependencies', 'Internal', 'Refactoring', 'Tests', 'Tooling'],
};

/** The subject of the merge commit that `buildMergeMessage` builds. */
export const MERGE_SUBJECT = '#867 release-kit|feat: Read the change record (#42)';

export const OPTIONS = { tagPrefixes: ['v'] };

/** Builds a squash-merge message whose body ends with a `change-record` block. */
export function buildMergeMessage(payload: string, subject = MERGE_SUBJECT): string {
  return [subject, '', 'Lede paragraph.', '', wrapInChangeRecordFence(payload)].join('\n');
}

/** Builds a raw commit, splitting its body from the subject as git does. */
export function makeCommit(message: string, hash: string): RawCommit {
  const subject = message.split('\n', 1)[0] ?? '';
  const bodyStart = message.indexOf('\n\n');
  return { hash, subject, body: bodyStart === -1 ? '' : message.slice(bodyStart + 2), message };
}

/** Builds a config whose changelog JSON settings override the defaults. */
export function makeConfig(overrides?: Partial<ChangelogJsonConfig>): Pick<ReleaseSettings, 'changelogJson'> {
  return {
    changelogJson: { ...defaultChangelogJsonConfig, ...overrides },
  };
}

/** Returns a 40-character hash that encodes an index. */
export function makeFakeHash(index: number): string {
  return String(index).padStart(40, '0');
}

/** Builds a release window in which each commit's hash is `makeFakeHash` of its position. */
export function makeWindow(version: string, messages: readonly string[], timestampSec = 1_700_000_000): ReleaseWindow {
  return { version, timestampSec, commits: messages.map((message, index) => makeCommit(message, makeFakeHash(index))) };
}

/** Wraps a YAML payload in a `change-record` fence. */
export function wrapInChangeRecordFence(payload: string): string {
  return ['```change-record', payload.trim(), '```'].join('\n');
}
