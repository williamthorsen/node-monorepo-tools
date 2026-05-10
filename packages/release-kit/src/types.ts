import { z } from 'zod';

/** Semver release type for version bumping. */
export type ReleaseType = 'major' | 'minor' | 'patch';

/** Target audience for a changelog section. */
export type ChangelogAudience = 'all' | 'dev';

/** A single item in a changelog section (typically one commit). */
export interface ChangelogItem {
  description: string;
  /** Optional commit body text, with trailing trailer metadata stripped. */
  body?: string;
  /**
   * Whether this item represents a breaking change.
   *
   * `true` when the commit subject carries the `!` prefix (e.g. `feat!:` or `drop(scope)!:`).
   * The `BREAKING CHANGE:` body footer is intentionally NOT considered here — only the prefix
   * `!` marks a changelog item as breaking. Renderers prefix breaking-item bullets with the
   * marker constructed from `WORK_TYPES_DATA.markers.breaking` (rendered as `🚨 **Breaking:** `
   * with the canonical SSOT values) to surface them prominently in release notes.
   */
  breaking?: boolean;
  /**
   * Full git commit SHA when known. Captured from git-cliff's `--context` output and
   * persisted in `changelog.json` so that override files can target items by hash. Synthetic
   * propagation entries (`buildSyntheticChangelogEntry`, `buildEmptyReleaseEntry`) leave
   * this field absent — they have no underlying commit.
   */
  hash?: string;
}

/** A grouped section within a changelog entry (e.g., "Features", "Bug fixes"). */
export interface ChangelogSection {
  /**
   * Section title carrying the leading emoji prefix used by `cliff.toml.template` group
   * definitions (e.g. `"🐛 Bug fixes"`). The `<!-- NN -->` canonical-order HTML comment
   * is stripped during transform; the emoji remains. Callers that match against `title`
   * (e.g. `sectionOrder` configs) must include the emoji prefix.
   */
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

/**
 * Editorial override for a single changelog item, keyed by commit hash (or hash prefix) in
 * the override file. All fields are optional; an entry with no fields is a validation error.
 *
 * `audience` declares the full forward-compatible vocabulary, but only `'skip'` is currently
 * supported at runtime. `'all'` and `'dev'` reclassification is reserved for a v2 follow-up
 * and rejected by the validator with an explicit "not yet supported" error so the on-disk
 * format remains stable through the v1→v2 transition.
 */
export interface ChangelogOverride {
  audience?: 'all' | 'dev' | 'skip';
  description?: string;
  body?: string;
  breaking?: boolean;
}

/** On-disk shape of `.meta/changelog-overrides.json`: a flat record keyed by commit hash or prefix. */
export type ChangelogOverridesFile = Record<string, ChangelogOverride>;

/** Configuration for release notes consumption (README injection). */
export interface ReleaseNotesConfig {
  shouldInjectIntoReadme: boolean;
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
 * A `!`-policy violation detected while parsing commits during release preparation.
 *
 * Surfaces from `releasePrepare`, `releasePrepareMono`, and `releasePrepareProject` via the
 * `policyViolations` field on each per-workspace/project result. The policy itself is enforced
 * tolerantly at release time — violations are collected and reported, never fail the release.
 */
export interface PolicyViolation {
  /** Full hash of the offending commit. */
  commitHash: string;
  /** First line of the commit message (raw, including any ticket prefix). */
  commitSubject: string;
  /** Resolved canonical work type whose policy was violated. */
  type: string;
  /** Where the violation was detected: `'prefix'` for `!`, `'body'` for `BREAKING CHANGE:` footer. */
  surface: 'prefix' | 'body';
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
  /** Policy violations detected while parsing this workspace's commits; omitted when none. */
  policyViolations?: PolicyViolation[];
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
  /** Policy violations detected while parsing this workspace's commits; omitted when none. */
  policyViolations?: PolicyViolation[];
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
  /** Policy violations detected while parsing the project's commits; omitted when none. */
  policyViolations?: PolicyViolation[];
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
  /** Policy violations detected while parsing the project's commits; omitted when none. */
  policyViolations?: PolicyViolation[];
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
  aliases?: string[] | undefined;
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

// region | Schemas for consumer-facing config file
//
// Defined in zod so the runtime validator and the static type stay in lockstep — adding a
// field to the schema flows through `z.infer` automatically; nothing can drift. Schemas
// describe the *input* shape (fields optional, no defaults). Resolved/post-merge shapes
// (`ChangelogJsonConfig`, `ReleaseNotesConfig`, `WorkspaceConfig`, etc.) stay as
// hand-written interfaces because they are produced by `mergeMonorepoConfig` after defaults
// are applied — they have nothing to validate.

/**
 * Schema for a single historical identity snapshot for a workspace.
 *
 * Captures what the package looked like at some earlier point: the full npm `name`
 * (e.g., `'@williamthorsen/nmr-core'`) and the `tagPrefix` under which tags were
 * published (e.g., `'core-v'`).
 */
export const legacyIdentitySchema = z
  .object({
    name: z.string().min(1),
    tagPrefix: z.string().min(1),
  })
  .strict();

/**
 * A single historical identity snapshot for a workspace. Both fields are required — a full
 * tuple stays unambiguous across any number of future renames.
 */
export type LegacyIdentity = z.infer<typeof legacyIdentitySchema>;

/**
 * Schema for a package that once lived in this repo but has since been extracted or removed.
 *
 * Unlike `legacyIdentitySchema`, retired packages are never consulted for baseline lookup
 * or changelog attribution — they acknowledge historical tag prefixes and suppress
 * undeclared-candidate warnings.
 */
export const retiredPackageSchema = z
  .object({
    name: z.string().min(1),
    tagPrefix: z.string().min(1),
    successor: z.string().min(1).optional(),
  })
  .strict();

/** A package that once lived in this repo but has since been extracted or removed. */
export type RetiredPackage = z.infer<typeof retiredPackageSchema>;

/** Schema for a single workspace override entry in the config file. */
export const workspaceOverrideSchema = z
  .object({
    dir: z.string().min(1),
    shouldExclude: z.boolean().optional(),
    legacyIdentities: z.array(legacyIdentitySchema).optional(),
  })
  .strict();

/** Override for a single workspace in the config file. Matches a discovered workspace by `dir`. */
export type WorkspaceOverride = z.infer<typeof workspaceOverrideSchema>;

/** Schema for the optional `project` block. */
export const projectConfigSchema = z
  .object({
    tagPrefix: z.string().min(1).optional(),
  })
  .strict();

/** Consumer-facing project-release config (`project` block). Empty object opts in to project releases. */
export type ProjectConfig = z.infer<typeof projectConfigSchema>;

/** Schema for the optional `changelogJson` block (input shape, all fields optional). */
export const changelogJsonInputSchema = z
  .object({
    enabled: z.boolean().optional(),
    outputPath: z.string().optional(),
    devOnlySections: z.array(z.string()).optional(),
  })
  .strict();

/** Schema for the optional `releaseNotes` block (input shape, all fields optional). */
export const releaseNotesInputSchema = z
  .object({
    shouldInjectIntoReadme: z.boolean().optional(),
  })
  .strict();

/** Schema for a single `workTypes` entry. */
export const workTypeConfigSchema = z
  .object({
    header: z.string(),
    aliases: z.array(z.string()).optional(),
  })
  .strict();

/** Schema for the `versionPatterns` block. Both arrays are required when the field is provided. */
export const versionPatternsSchema = z
  .object({
    major: z.array(z.string()),
    minor: z.array(z.string()),
  })
  .strict();

/** Schema for a single `breakingPolicies` value. */
export const breakingPolicyValueSchema = z.enum(['forbidden', 'optional', 'required']);

/** Schema for the consumer-facing config file shape (`.config/release-kit.config.ts`). */
export const releaseKitConfigSchema = z
  .object({
    breakingPolicies: z.record(z.string(), breakingPolicyValueSchema).optional(),
    changelogJson: changelogJsonInputSchema.optional(),
    cliffConfigPath: z.string().min(1).optional(),
    formatCommand: z.string().min(1).optional(),
    project: projectConfigSchema.optional(),
    releaseNotes: releaseNotesInputSchema.optional(),
    retiredPackages: z.array(retiredPackageSchema).optional(),
    scopeAliases: z.record(z.string(), z.string()).optional(),
    versionPatterns: versionPatternsSchema.optional(),
    workspaces: z.array(workspaceOverrideSchema).optional(),
    workTypes: z.record(z.string(), workTypeConfigSchema).optional(),
  })
  .strict();

/**
 * Consumer-facing config file shape (`.config/release-kit.config.ts`).
 * All fields are optional; defaults are applied during config merging.
 */
export type ReleaseKitConfig = z.infer<typeof releaseKitConfigSchema>;

// endregion | Schemas for consumer-facing config file

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
  /**
   * Whether this workspace can be published to a registry. `true` when `package.json#private`
   * is absent or `false`; `false` only when `private === true`. Consumed by `release-kit publish`
   * to filter unpublishable workspaces; other commands ignore this field.
   */
  isPublishable: boolean;
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
   * Per-canonical-type breaking-policy lookup. Defaults to `DEFAULT_BREAKING_POLICIES`. When
   * provided, replaces the default entirely. Pass `{}` to disable enforcement (parser falls
   * back to `'optional'` for missing types).
   */
  breakingPolicies?: Record<string, 'forbidden' | 'optional' | 'required'>;
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
   * Per-canonical-type breaking-policy lookup. Defaults to `DEFAULT_BREAKING_POLICIES`. When
   * provided, replaces the default entirely. Pass `{}` to disable enforcement (parser falls
   * back to `'optional'` for missing types).
   */
  breakingPolicies?: Record<string, 'forbidden' | 'optional' | 'required'>;
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
