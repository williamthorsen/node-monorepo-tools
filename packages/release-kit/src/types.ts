/** Semver release type for version bumping. */
export type ReleaseType = 'major' | 'minor' | 'patch';

/** Structured result from bumping version fields in package.json files. */
export interface BumpResult {
  currentVersion: string;
  newVersion: string;
  files: string[];
}

/** Result of preparing a single component (package) for release. */
export interface ComponentPrepareResult {
  /** Component name; absent in single-package mode, present in monorepo mode. */
  name?: string | undefined;
  status: 'released' | 'skipped';
  previousTag?: string | undefined;
  commitCount: number;
  parsedCommitCount?: number | undefined;
  releaseType?: ReleaseType | undefined;
  currentVersion?: string | undefined;
  newVersion?: string | undefined;
  tag?: string | undefined;
  bumpedFiles: string[];
  changelogFiles: string[];
  /** Commits that could not be parsed into a recognized work type. */
  unparseableCommits?: Commit[] | undefined;
  skipReason?: string | undefined;
}

/** Aggregate result of the prepare workflow for both single-package and monorepo modes. */
export interface PrepareResult {
  components: ComponentPrepareResult[];
  tags: string[];
  formatCommand?:
    | {
        command: string;
        executed: boolean;
        files: string[];
      }
    | undefined;
  dryRun: boolean;
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
   * Component overrides. Each entry matches a discovered workspace by `dir`.
   * Use `shouldExclude: true` to remove a component from release processing.
   */
  components?: ComponentOverride[];
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
   * Maps workspace shorthand names to their canonical names.
   * When a commit uses `shorthand|type: description`, the shorthand is resolved
   * to the canonical workspace name before the parsed commit is returned.
   */
  workspaceAliases?: Record<string, string>;
}

/** Override for a single component in the config file. */
export interface ComponentOverride {
  /** The package directory name (e.g., 'arrays'). */
  dir: string;
  /** If true, exclude this component from release processing. */
  shouldExclude?: boolean;
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
  /** The workspace scope if the commit used `workspace|type:` format. */
  workspace?: string;
  /** Whether this is a breaking change. */
  breaking: boolean;
}

/** Per-component configuration for monorepo releases. */
export interface ComponentConfig {
  /** The package directory name (e.g., 'arrays'). Used for display and `--only` matching. */
  dir: string;
  /** The git tag prefix for this component (e.g., 'arrays-v'). */
  tagPrefix: string;
  /** Paths to package.json files to bump. */
  packageFiles: string[];
  /** Directories in which to generate changelogs. */
  changelogPaths: string[];
  /** Glob patterns passed to `git log -- <paths>` for commit filtering. */
  paths: string[];
}

/** Configuration for a monorepo release workflow with multiple components. */
export interface MonorepoReleaseConfig {
  /** Ordered list of component configurations. */
  components: ComponentConfig[];
  /** Work type configurations shared across all components. Defaults to `DEFAULT_WORK_TYPES`. */
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
   * Maps workspace shorthand names to their canonical names.
   * When a commit uses `shorthand|type: description`, the shorthand is resolved
   * to the canonical workspace name before the parsed commit is returned.
   */
  workspaceAliases?: Record<string, string>;
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
   * Maps workspace shorthand names to their canonical names.
   * When a commit uses `shorthand|type: description`, the shorthand is resolved
   * to the canonical workspace name before the parsed commit is returned.
   */
  workspaceAliases?: Record<string, string>;
}
