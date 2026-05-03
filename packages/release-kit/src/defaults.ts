import type { ChangelogJsonConfig, ReleaseNotesConfig, VersionPatterns, WorkTypeConfig } from './types.ts';

/** Default work types ordered by priority, matching the skypilot-site convention. */
export const DEFAULT_WORK_TYPES: Record<string, WorkTypeConfig> = {
  fix: { header: '🐛 Bug fixes', aliases: ['bugfix'] },
  deprecate: { header: '🗑️ Deprecated' },
  feat: { header: '🎉 Features', aliases: ['feature'] },
  internal: { header: '🏗️ Internal' },
  perf: { header: '⚡ Performance', aliases: ['performance'] },
  refactor: { header: '♻️ Refactoring' },
  sec: { header: '🔒 Security', aliases: ['security'] },
  tests: { header: '🧪 Tests', aliases: ['test'] },
  tooling: { header: '⚙️ Tooling' },
  ci: { header: '👷 CI' },
  deps: { header: '📦 Dependencies', aliases: ['dep'] },
  docs: { header: '📚 Documentation', aliases: ['doc'] },
  ai: { header: '🤖 Agentic support' },
  // `fmt` is retained for bump-determination (`parseCommitMessage`), even though
  // `cliff.toml.template` skips `fmt:` commits so they never enter the changelog.
  fmt: { header: 'Formatting' },
};

/** Default version bump patterns. */
export const DEFAULT_VERSION_PATTERNS: VersionPatterns = {
  major: ['!'],
  minor: ['feat'],
};

/** Default configuration for structured changelog JSON generation. */
export const DEFAULT_CHANGELOG_JSON_CONFIG: ChangelogJsonConfig = {
  enabled: true,
  outputPath: '.meta/changelog.json',
  devOnlySections: [
    '🤖 Agentic support',
    '👷 CI',
    '📦 Dependencies',
    '🏗️ Internal',
    '♻️ Refactoring',
    '🧪 Tests',
    '⚙️ Tooling',
  ],
};

/** Default configuration for release notes consumption. */
export const DEFAULT_RELEASE_NOTES_CONFIG: ReleaseNotesConfig = {
  shouldInjectIntoReadme: false,
};

/** Default tag prefix for project-level releases. */
export const DEFAULT_PROJECT_TAG_PREFIX = 'v';
