/** Semver release type for version bumping. */
export type ReleaseType = 'major' | 'minor' | 'patch';

/** Target audience for a changelog section. */
export type ChangelogAudience = 'all' | 'dev';

/** A single item in a changelog section (typically one commit). */
export interface ChangelogItem {
  description: string;
  /** Optional commit body text, with trailing trailer metadata stripped. */
  body?: string;
}

/** A grouped section within a changelog entry (e.g., "Features", "Bug fixes"). */
export interface ChangelogSection {
  title: string;
  audience: ChangelogAudience;
  items: ChangelogItem[];
}

/** A single version's changelog data. */
export interface ChangelogEntry {
  version: string;
  date: string;
  sections: ChangelogSection[];
}

/** Configuration for structured changelog JSON generation. */
export interface ChangelogJsonConfig {
  enabled: boolean;
  outputPath: string;
  devOnlySections: string[];
}

/** Configuration for release notes consumption (README injection). */
export interface ReleaseNotesConfig {
  shouldInjectIntoReadme: boolean;
}

/**
 * Consumer-facing project-release config (`project` block in `release-kit.config.ts`).
 *
 * Declaring an empty `project: {}` opts the repo into project-level releases. All fields
 * are optional; defaults are applied during config merging. The set of contributing
 * workspaces is implicit — every non-excluded discovered workspace contributes.
 */
export interface ProjectConfig {
  /** Tag prefix for project-level tags (e.g., `'v'` produces `'v1.2.0'`). Defaults to `'v'`. */
  tagPrefix?: string;
}

/**
 * Project-release config after merging defaults. Mirrors the `ReleaseNotesConfig`/
 * `ResolvedReleaseNotesConfig`-style split: optional fields in `ProjectConfig` become
 * required in `ResolvedProjectConfig`.
 */
export interface ResolvedProjectConfig {
  /** Resolved tag prefix for project-level tags. */
  tagPrefix: string;
}

/** Identifies a dependency whose version bump triggered a propagated release. */
export interface PropagationSource {
  packageName: string;
  newVersion: string;
}

/** Structured result from bumping version fields in package.json files. */
export interface BumpResult {
  currentVersion: string;
  newVersion: string;
  files: string[];
}

/**
 * Result of preparing a single workspace (package) for release when a release was produced.
 *
 * `currentVersion`, `newVersion`, `tag`, `bumpedFiles`, and `changelogFiles` are always
 * populated. `releaseType` stays optional because it is left undefined for
 * `--set-version` workspaces. `parsedCommitCount` stays optional because the legacy
 * single-package bump-override path does not populate it. `commits` stays optional
 * because propagation-only releases have no direct commits.
 */
export interface ReleasedWorkspaceResult {
  status: 'released';
  /** Workspace name; absent in single-package mode, present in monorepo mode. */
  name?: string;
  previousTag?: string;
  commitCount: number;
  /**
   * Count of commits that parsed into a recognized work type. Always populated for
   * results produced by the unified `decideRelease` algorithm (the monorepo path),
   * including the no-commits case where it is `0`. May be absent for results
   * produced by the legacy single-package executor's bump-override path. Use
   * `bumpOverride` (not `parsedCommitCount === undefined`) as the signal for "the
   * user supplied --bump=X".
   */
  parsedCommitCount?: number;
  /** Commits that could not be parsed into a recognized work type. */
  unparseableCommits?: Commit[];
  releaseType?: ReleaseType;
  currentVersion: string;
  newVersion: string;
  tag: string;
  bumpedFiles: string[];
  changelogFiles: string[];
  /** Raw commits associated with this workspace (present for direct releases, absent for propagation-only). */
  commits?: Commit[];
  /**
   * Present when `--bump=X` was supplied and selected the release level for this workspace.
   * Distinguishes a bump-override release from a `--force` fallback or a natural-bump release;
   * consumed by the renderer to label the release accurately.
   */
  bumpOverride?: ReleaseType;
  /** Dependencies that triggered a propagated bump (present for propagated or mixed workspaces). */
  propagatedFrom?: PropagationSource[];
  /** Present when this workspace was written via `--set-version`; the explicit version that was applied. */
  setVersion?: string;
}

/**
 * Result of preparing a single workspace (package) for release when the release was skipped.
 *
 * Carries diagnostic data (`commitCount`, `parsedCommitCount`, `unparseableCommits`,
 * `previousTag`) plus the human-readable `skipReason`. Release-only fields are absent.
 */
export interface SkippedWorkspaceResult {
  status: 'skipped';
  /** Workspace name; absent in single-package mode, present in monorepo mode. */
  name?: string;
  previousTag?: string;
  commitCount: number;
  /**
   * Count of commits that parsed into a recognized work type. May be absent for results
   * produced by the legacy single-package executor's bump-override path.
   */
  parsedCommitCount?: number;
  /** Commits that could not be parsed into a recognized work type. */
  unparseableCommits?: Commit[];
  skipReason: string;
}

/**
 * Result of preparing a single workspace (package) for release.
 *
 * Discriminated by `status`: `ReleasedWorkspaceResult` for produced releases,
 * `SkippedWorkspaceResult` for skips.
 */
export type WorkspacePrepareResult = ReleasedWorkspaceResult | SkippedWorkspaceResult;

/**
 * Result of preparing a project-level release when a release was produced.
 *
 * Mirrors `ReleasedWorkspaceResult` minus the workspace-only fields (`name`,
 * `propagatedFrom`, `setVersion`). Project releases never propagate and never use
 * `--set-version`, so `releaseType`, `currentVersion`, `newVersion`, `tag`, and
 * `commits` are all required.
 */
export interface ReleasedProjectResult {
  status: 'released';
  previousTag?: string;
  commitCount: number;
  /**
   * Count of commits that parsed into a recognized work type. Always populated by the
   * unified `decideRelease` algorithm — `0` when there are no commits or when none
   * parse. Use `bumpOverride` (not `parsedCommitCount === 0`) as the signal for "the
   * user supplied --bump=X".
   */
  parsedCommitCount: number;
  /** Commits that could not be parsed into a recognized work type. */
  unparseableCommits?: Commit[];
  releaseType: ReleaseType;
  currentVersion: string;
  newVersion: string;
  tag: string;
  bumpedFiles: string[];
  changelogFiles: string[];
  /** Raw commits in the project's contributing-paths window since the last project tag. */
  commits: Commit[];
  /**
   * Present when `--bump=X` was supplied and selected the release level for the project.
   * Distinguishes a bump-override release from a `--force` fallback or a natural-bump release;
   * consumed by the renderer to label the release accurately.
   */
  bumpOverride?: ReleaseType;
}

/**
 * Result of preparing a project-level release when the release was skipped.
 *
 * Carries diagnostic data (`commitCount`, `parsedCommitCount`, `unparseableCommits`,
 * `previousTag`) plus the human-readable `skipReason`. Release-only fields are absent.
 */
export interface SkippedProjectResult {
  status: 'skipped';
  previousTag?: string;
  commitCount: number;
  /**
   * Count of commits that parsed into a recognized work type. Always populated by the
   * unified `decideRelease` algorithm — `0` when there are no commits or when none
   * parse.
   */
  parsedCommitCount: number;
  /** Commits that could not be parsed into a recognized work type. */
  unparseableCommits?: Commit[];
  skipReason: string;
}

/**
 * Result of preparing a project-level release.
 *
 * Discriminated by `status`: `ReleasedProjectResult` for produced releases,
 * `SkippedProjectResult` for skips. `PrepareResult.project === undefined` continues to
 * mean "no project block configured" — only the result shape varies when the block IS
 * configured.
 */
export type ProjectPrepareResult = ReleasedProjectResult | SkippedProjectResult;

/** Aggregate result of the prepare workflow for both single-package and monorepo modes. */
export interface PrepareResult {
  workspaces: WorkspacePrepareResult[];
  tags: string[];
  formatCommand?:
    | {
        command: string;
        executed: boolean;
        files: string[];
      }
    | undefined;
  dryRun: boolean;
  /** Warnings surfaced during preparation (e.g., circular dependency detection). */
  warnings?: string[] | undefined;
  /** Result of the project-level release stage (present only when `config.project` is configured and the stage ran). */
  project?: ProjectPrepareResult | undefined;
}

/** Configuration for a single work type used in commit categorization. */
export interface WorkTypeConfig {
  /** Human-readable label for the section heading in changelogs. */
  header: string;
  /** Optional aliases that map to this work type (e.g., 'feature' -> 'feat'). */
  aliases?: string[];
}

/**
 * Defines which commit types trigger major or minor version bumps.
 * Any recognized commit type not listed defaults to a patch bump.
 * The sentinel `'!'` in `major` means "any breaking commit triggers a major bump".
 */
export interface VersionPatterns {
  /** Patterns that trigger a major bump. Use `'!'` for any breaking change. */
  major: string[];
  /** Commit types that trigger a minor bump. */
  minor: string[];
}

/**
 * Consumer-facing config file shape (`.config/release-kit.config.ts`).
 * All fields are optional; defaults are applied during config merging.
 */
export interface ReleaseKitConfig {
  /**
   * Workspace overrides. Each entry matches a discovered workspace by `dir`.
   * Use `shouldExclude: true` to remove a workspace from release processing.
   */
  workspaces?: WorkspaceOverride[];
  /** Version bump patterns. Replaces defaults entirely when provided. */
  versionPatterns?: VersionPatterns;
  /** Work type overrides. Merged with defaults by key. */
  workTypes?: Record<string, WorkTypeConfig>;
  /**
   * Shell command to run after all changelogs are generated (e.g., 'pnpm run fmt').
   * Modified file paths (package.json files and CHANGELOGs) are appended as space-separated
   * arguments. Paths are repo-relative; file paths containing spaces are not supported.
   */
  formatCommand?: string;
  /** Path to the cliff.toml file; defaults to 'cliff.toml' when absent. */
  cliffConfigPath?: string;
  /**
   * Maps scope shorthand names to their canonical names.
   * When a commit uses `shorthand|type: description` or `type(shorthand): description`,
   * the shorthand is resolved to the canonical scope name before the parsed commit is returned.
   */
  scopeAliases?: Record<string, string>;
  /** Controls structured changelog JSON generation. */
  changelogJson?: Partial<ChangelogJsonConfig>;
  /** Controls release notes consumption (README injection). */
  releaseNotes?: Partial<ReleaseNotesConfig>;
  /**
   * Packages that once lived in this repo but have since been extracted or removed.
   *
   * Complements the per-workspace `workspaces[].legacyIdentities` field. Use
   * `legacyIdentities` when the workspace still exists under a new identity; use
   * `retiredPackages` when no workspace for this package exists in this repo anymore.
   * Retired packages are never consulted for baseline lookup or changelog attribution —
   * their declared `tagPrefix` values are treated as known so `show-tag-prefixes` does
   * not flag them as undeclared candidates.
   */
  retiredPackages?: RetiredPackage[];
  /**
   * Project-level release block. Declaring `project: {}` (even empty) opts the repo into
   * project-level releases: each `prepare` run additionally bumps the root `package.json`,
   * regenerates the root `CHANGELOG.md`, and emits a project tag. Contributing workspaces
   * are implicitly all non-excluded discovered workspaces. Single-package mode does not
   * support this block.
   */
  project?: ProjectConfig;
}

/**
 * A single historical identity snapshot for a workspace.
 *
 * Captures what the package looked like at some earlier point: the full npm `name`
 * (e.g., `'@williamthorsen/nmr-core'`) and the `tagPrefix` under which tags
 * were published (e.g., `'core-v'`). Both fields are required — a full tuple stays
 * unambiguous across any number of future renames.
 */
export interface LegacyIdentity {
  /** Full scoped npm name as it appeared at the time (e.g., `'@scope/pkg'`). */
  name: string;
  /** Tag prefix under which the workspace's historical tags were published (e.g., `'core-v'`). */
  tagPrefix: string;
}

/**
 * A package that once lived in this repo but has since been extracted or removed.
 *
 * Unlike `LegacyIdentity`, retired packages are never consulted for baseline lookup or
 * changelog attribution — they exist purely to acknowledge historical tag prefixes and
 * suppress undeclared-candidate warnings. Use `legacyIdentities` when the workspace
 * still exists under a new identity; use `retiredPackages` when no workspace for this
 * package exists anymore.
 */
export interface RetiredPackage {
  /** The package's final npm name while it lived in this repo. */
  name: string;
  /** The tag prefix under which the package's tags were published (e.g., `'preflight-v'`). */
  tagPrefix: string;
  /** Optional successor package name, for packages that were renamed/extracted rather than deleted. */
  successor?: string;
}

/** Override for a single workspace in the config file. */
export interface WorkspaceOverride {
  /** The package directory name (e.g., 'arrays'). */
  dir: string;
  /** If true, exclude this workspace from release processing. */
  shouldExclude?: boolean;
  /**
   * Prior identities of this workspace, used to recognize historical tags across renames.
   * Each entry is a complete `(name, tagPrefix)` snapshot. The union of the current `tagPrefix`
   * and each identity's `tagPrefix` is consulted when release-kit searches for the most recent
   * baseline tag and when generating changelogs. Declaring identities allows release-kit to
   * recognize legacy tags without any tag mutation.
   */
  legacyIdentities?: LegacyIdentity[];
}

/** A raw commit from the git log. */
export interface Commit {
  /** The full commit message (first line). */
  message: string;
  /** The commit hash. */
  hash: string;
}

/** A commit that has been parsed to extract structured metadata. */
export interface ParsedCommit {
  /** The original commit message. */
  message: string;
  /** The commit hash. */
  hash: string;
  /** The resolved work type (e.g., 'feat', 'fix'). */
  type: string;
  /** The commit description after the type prefix. */
  description: string;
  /** The scope extracted from `scope|type:` or `type(scope):` format. */
  scope?: string;
  /** Whether this is a breaking change. */
  breaking: boolean;
}

/** Per-workspace configuration for monorepo releases. */
export interface WorkspaceConfig {
  /** The package directory name (e.g., 'arrays'). Used for display and `--only` matching. */
  dir: string;
  /** The full scoped npm name from `package.json` (e.g., `'@williamthorsen/nmr-core'`). */
  name: string;
  /** The git tag prefix for this workspace (e.g., 'nmr-core-v'), derived from the unscoped `package.json` name. */
  tagPrefix: string;
  /** Workspace-relative path to the package root (e.g., `packages/core`). */
  workspacePath: string;
  /** Paths to package.json files to bump. */
  packageFiles: string[];
  /** Directories in which to generate changelogs. */
  changelogPaths: string[];
  /** Glob patterns passed to `git log -- <paths>` for commit filtering. */
  paths: string[];
  /**
   * Prior identities of this workspace. Each identity's `tagPrefix` is consulted in addition
   * to the current `tagPrefix` when searching for baseline tags and generating changelogs.
   * `undefined` is equivalent to the empty array.
   */
  legacyIdentities?: LegacyIdentity[];
}

/** Configuration for a monorepo release workflow with multiple workspaces. */
export interface MonorepoReleaseConfig {
  /** Ordered list of workspace configurations. */
  workspaces: WorkspaceConfig[];
  /** Work type configurations shared across all workspaces. Defaults to `DEFAULT_WORK_TYPES`. */
  workTypes?: Record<string, WorkTypeConfig>;
  /** Version bump patterns. Defaults to `DEFAULT_VERSION_PATTERNS`. */
  versionPatterns?: VersionPatterns;
  /**
   * Shell command to run after all changelogs are generated (e.g., 'pnpm run fmt').
   * Modified file paths (package.json files and CHANGELOGs) are appended as space-separated
   * arguments. Paths are repo-relative; file paths containing spaces are not supported.
   */
  formatCommand?: string;
  /** Path to the cliff.toml file; defaults to 'cliff.toml' when absent. */
  cliffConfigPath?: string;
  /**
   * Maps scope shorthand names to their canonical names.
   * When a commit uses `shorthand|type: description` or `type(shorthand): description`,
   * the shorthand is resolved to the canonical scope name before the parsed commit is returned.
   */
  scopeAliases?: Record<string, string>;
  /** Controls structured changelog JSON generation. */
  changelogJson: ChangelogJsonConfig;
  /** Controls release notes consumption (README injection). */
  releaseNotes: ReleaseNotesConfig;
  /**
   * Project-level release config. Present iff the consumer declared `project: {}`. When
   * present, `releasePrepareMono` runs an additional project-release stage after the
   * per-workspace loop.
   */
  project?: ResolvedProjectConfig;
}

/** Configuration for the release workflow. */
export interface ReleaseConfig {
  /** The git tag prefix used to identify version tags (e.g., 'v'). */
  tagPrefix: string;
  /** Paths to package.json files to bump. */
  packageFiles: string[];
  /** Paths to directories in which to generate changelogs. */
  changelogPaths: string[];
  /** Work type configurations. Defaults to `DEFAULT_WORK_TYPES`. */
  workTypes?: Record<string, WorkTypeConfig>;
  /** Version bump patterns. Defaults to `DEFAULT_VERSION_PATTERNS`. */
  versionPatterns?: VersionPatterns;
  /**
   * Shell command to run after changelog generation (e.g., 'pnpm run fmt').
   * Modified file paths (package.json files and CHANGELOGs) are appended as space-separated
   * arguments. Paths are repo-relative; file paths containing spaces are not supported.
   */
  formatCommand?: string;
  /** Path to the cliff.toml file; defaults to 'cliff.toml' when absent. */
  cliffConfigPath?: string;
  /**
   * Maps scope shorthand names to their canonical names.
   * When a commit uses `shorthand|type: description` or `type(shorthand): description`,
   * the shorthand is resolved to the canonical scope name before the parsed commit is returned.
   */
  scopeAliases?: Record<string, string>;
  /** Controls structured changelog JSON generation. */
  changelogJson: ChangelogJsonConfig;
  /** Controls release notes consumption (README injection). */
  releaseNotes: ReleaseNotesConfig;
}
