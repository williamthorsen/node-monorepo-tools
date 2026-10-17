import type { RawCommit, ReleaseWindow } from '../enumerateReleaseWindows.ts';
import type { ChangelogJsonConfig, ReleaseSettings } from '../types.ts';

const defaultChangelogJsonConfig: ChangelogJsonConfig = {
  enabled: true,
  outputPath: '.meta/changelog.json',
  devOnlySections: ['CI', 'Dependencies', 'Internal', 'Refactoring', 'Tests', 'Tooling'],
};

/** The subject of the merge commit that `mergeMessage` builds. */
export const MERGE_SUBJECT = '#867 release-kit|feat: Read the change record (#42)';

export const OPTIONS = { tagPrefixes: ['v'] };

/** Wraps a YAML payload in a `change-record` fence. */
export function block(payload: string): string {
  return ['```change-record', payload.trim(), '```'].join('\n');
}

/** Returns a 40-character hash that encodes an index. */
export function fakeHash(index: number): string {
  return String(index).padStart(40, '0');
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

/** Builds a release window in which each commit's hash is `fakeHash` of its position. */
export function makeWindow(version: string, messages: readonly string[], timestamp = 1_700_000_000): ReleaseWindow {
  return { version, timestamp, commits: messages.map((message, index) => makeCommit(message, fakeHash(index))) };
}

/** Builds a squash-merge message whose body ends with a `change-record` block. */
export function mergeMessage(payload: string, subject = MERGE_SUBJECT): string {
  return [subject, '', 'Lede paragraph.', '', block(payload)].join('\n');
}
