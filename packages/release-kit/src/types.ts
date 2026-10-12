import type { BreakingPolicy } from '@williamthorsen/change-grammar';
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
   * `true` when the commit subject has the `!` marker (e.g. `feat!:` or `drop(scope)!:`), or the
   * change-record entry from which the item derives sets `breaking: true`, and the work-type policy
   * permits it, so that the item agrees with the version bump. The `BREAKING CHANGE:` body footer
   * does not set it.
   */
  breaking?: boolean;
  /**
   * Migration instruction for a consumer, taken from the `Migration:` paragraph of `body`, or from
   * the `migration` of the change-record entry from which the item derives.
   *
   * On a title-derived item, derived from `body` whenever `body` is set, and absent when the body
   * does not contain any labeled paragraph. Independent of `breaking`: A `deprecate` commit cannot
   * take `!` under the default breaking policy and still calls for a migration. `body` keeps the
   * paragraph, so `CHANGELOG.md` goes on rendering it in place.
   */
  migration?: string;
  /**
   * Full git commit SHA when known. Captured from the commit's release window and
   * persisted in `changelog.json` so that override files can target items by hash. Synthetic
   * propagation entries (`buildSyntheticChangelogEntry`, `buildEmptyReleaseEntry`) leave
   * this field absent, because they do not have any underlying commit.
   */
  hash?: string;
  /**
   * 1-based position of the change-record entry from which this item derives, counted over the block's entries as
   * written. Absent for an item derived from the commit's title.
   */
  entry?: number;
}

/** A grouped section within a changelog entry (e.g., "Features", "Bug fixes"). */
export interface ChangelogSection {
  /**
   * Section title, read from the work type of the commit or of its change-record entry. A default
   * title begins with the type's emoji (e.g. `"🐛 Bug fixes"`), which an exact match against
   * `title`, such as a `sectionOrder` list, must include.
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
 * Editorial override for changelog items, keyed in the override file by `<hash>` (every item of the commit) or
 * `<hash>:<n>` (the item derived from the commit's `n`th change-record entry), where the hash is lowercase hex
 * matched as a prefix. All fields are optional; an entry without any fields is a validation error.
 *
 * `audience` admits `'all'` and `'dev'`, but the validator rejects both with a "not yet supported"
 * error; only `'skip'` takes effect.
 */
export interface ChangelogOverride {
  audience?: 'all' | 'dev' | 'skip';
  description?: string;
  body?: string;
  breaking?: boolean;
}

/**
 * Overrides in `.meta/changelog-overrides.json`: a flat record keyed by `<hash>` or `<hash>:<n>`. The file may also contain
 * a top-level `$schema` string, which the loader drops.
 */
export type ChangelogOverridesFile = Record<string, ChangelogOverride>;

/** Configuration for release notes consumption (README injection). */
export interface ReleaseNotesConfig {
  shouldInjectIntoReadme: boolean;
}

/**
 * The composite release after merging defaults, declared by a `project` block or by a `releases` composite entry.
 * Both are versioned by the root `package.json`.
 */
export interface ResolvedProjectConfig {
  /**
   * Resolved commit window for the project release: the git pathspecs that select which commits
   * the stage considers. Defaults to the union of every contributing workspace's `paths`.
   */
  paths: string[];
  /** Resolved tag prefix for project-level tags. */
  tagPrefix: string;
  /** Name that selects the composite; `undefined` for a `project` block, whose composite cannot be selected. */
  name?: string;
  /** Target names of the member workspaces; `undefined` means every retained workspace, as a `project` block has. */
  members?: string[];
}

/** Identifies a dependency whose version bump triggered a propagated release. */
export interface PropagationSource {
  packageName: string;
  newVersion: string;
}

/**
 * A `!`-policy violation detected while reading the unreleased window during release preparation. Violations are
 * reported and never fail the release.
 */
export interface PolicyViolation {
  /** Full hash of the offending commit. */
  commitHash: string;
  /** First line of the commit message (raw, including any ticket prefix). */
  commitSubject: string;
  /** Resolved canonical work type whose policy was violated. */
  type: string;
  /**
   * Where the violation was detected: `'prefix'` for `!`, `'body'` for `BREAKING CHANGE:` footer, `'entry'` for a
   * change-record entry's `breaking`.
   */
  surface: 'prefix' | 'body' | 'entry';
  /** 1-based position of the offending change-record entry; present only for surface `'entry'`. */
  entryPosition?: number;
}

/** A commit whose `change-record` block could not be read, so that its changelog item came from its title. */
export interface MalformedChangeRecordBlock {
  /** Full hash of the commit. */
  commitHash: string;
  /** First line of the commit message. */
  commitSubject: string;
  /** The defect that stopped the read. */
  reason: string;
}

/**
 * A change-record entry whose type the work-type taxonomy does not declare, so that it did not yield any changelog
 * item.
 */
export interface UndeclaredEntryType {
  /** Full hash of the commit. */
  commitHash: string;
  /** First line of the commit message. */
  commitSubject: string;
  /** 1-based position of the entry in its block. */
  entryPosition: number;
  /** The type as the entry declares it. */
  type: string;
}

/** A change-record entry scope that does not name any workspace whose unreleased window contains its commit. */
export interface UnroutedEntryScope {
  /** Full hash of the commit. */
  commitHash: string;
  /** First line of the commit message. */
  commitSubject: string;
  /** 1-based position of the entry in its block. */
  entryPosition: number;
  /** The scope as the entry declares it. */
  scope: string;
}

/**
 * What `prepare` did with the existing `##` sections of one `CHANGELOG.md` that the regenerated file does not render
 * from entries.
 */
export interface ChangelogPreservation {
  /** The `CHANGELOG.md` path. */
  file: string;
  /** Versions whose sections were kept verbatim, because neither the built entries nor `changelog.json` contain them. */
  preservedVersions: string[];
  /** Headings of the sections that do not name any version, which the regenerated file does not contain. */
  droppedUnversionedHeadings: string[];
}

/** Fields of every target result: what `prepare` read from the target's unreleased window. */
interface TargetResultFields {
  /** Id of the target that the result describes. */
  targetId: string;
  previousTag?: string;
  commitCount: number;
  /** Commits that do not yield any changelog item and are not accounted for by any exclusion or diagnostic. */
  unparseableCommits?: Commit[];
  /** Policy violations of the unreleased window's titles and change-record entries; omitted when none. */
  policyViolations?: PolicyViolation[];
  /** Commits of the unreleased window whose `change-record` block could not be read; omitted when none. */
  malformedBlocks?: MalformedChangeRecordBlock[];
  /** Change-record entries of the unreleased window whose type is undeclared; omitted when none. */
  undeclaredEntryTypes?: UndeclaredEntryType[];
}

/** Fields of every released target result: the version, tag, and files of the release. */
interface ReleaseFields {
  currentVersion: string;
  newVersion: string;
  tag: string;
  bumpedFiles: string[];
  changelogFiles: string[];
  /** Release-notes preview files; present only under `--with-release-notes`. */
  previewFiles?: string[];
  /**
   * Per `CHANGELOG.md`, the existing sections that were kept or dropped; omitted when `prepare` did not keep or drop
   * any.
   */
  changelogPreservation?: ChangelogPreservation[];
  /**
   * Present when `--bump=X` was supplied and selected the release level, which distinguishes a bump-override release
   * from a `--force` fallback or a natural-bump release.
   */
  bumpOverride?: ReleaseType;
}

/** Fields of every package target result. */
interface PackageResultFields extends TargetResultFields {
  kind: 'package';
  /** Workspace `dir`; absent for the single-package root. */
  name?: string;
  /** Change-record entry scopes of the unreleased window that route their entry nowhere; omitted when none. */
  unroutedEntryScopes?: UnroutedEntryScope[];
}

/** Result of a package target that releases. `releaseType` is absent for `--set-version`. */
export interface ReleasedPackageResult extends PackageResultFields, ReleaseFields {
  status: 'released';
  /**
   * Count of commits that yield at least one changelog item; `0` when the unreleased window does
   * not contain any commits or when none does. Absent for `--set-version` and propagation-only
   * releases. `bumpOverride`, not this count, signals that the user supplied `--bump=X`.
   */
  parsedCommitCount?: number;
  releaseType?: ReleaseType;
  /** Raw commits of the package's unreleased window. */
  commits?: Commit[];
  /** Dependencies that triggered a propagated bump (present for propagated or mixed releases). */
  propagatedFrom?: PropagationSource[];
  /** Present when propagation alone set the bump, the package's own commits having called for none. */
  propagatedOnly?: true;
  /** Present when the package was written via `--set-version`; the explicit version that was applied. */
  setVersion?: string;
}

/** Result of a package target that skips: the diagnostic fields and a human-readable `skipReason`. */
export interface SkippedPackageResult extends PackageResultFields {
  status: 'skipped';
  /**
   * Count of commits that yield at least one changelog item; `0` when the unreleased window does not contain any
   * commits or when none does.
   */
  parsedCommitCount: number;
  skipReason: string;
}

/** Fields of every directory target result. */
interface DirectoryResultFields extends TargetResultFields {
  kind: 'directory';
  /** Name of the directory target. */
  name: string;
  /** Change-record entry scopes of the unreleased window that route their entry nowhere; omitted when none. */
  unroutedEntryScopes?: UnroutedEntryScope[];
}

/**
 * Result of a directory target that releases. A directory never propagates; `releaseType` and `parsedCommitCount` are
 * absent for `--set-version`.
 */
export interface ReleasedDirectoryResult extends DirectoryResultFields, ReleaseFields {
  status: 'released';
  /**
   * Count of commits that yield at least one changelog item; `0` when the unreleased window does not contain any
   * commits or when none does.
   */
  parsedCommitCount?: number;
  releaseType?: ReleaseType;
  /** Raw commits of the directory's unreleased window. */
  commits: Commit[];
  /** Present when the directory was written via `--set-version`; the explicit version that was applied. */
  setVersion?: string;
}

/** Result of a directory target that skips: the diagnostic fields and a human-readable `skipReason`. */
export interface SkippedDirectoryResult extends DirectoryResultFields {
  status: 'skipped';
  /**
   * Count of commits that yield at least one changelog item; `0` when the unreleased window does not contain any
   * commits or when none does.
   */
  parsedCommitCount: number;
  skipReason: string;
}

/**
 * Result of a composite target that releases. A composite never propagates and never takes `--set-version`, so
 * `releaseType`, `parsedCommitCount`, and `commits` are required.
 */
export interface ReleasedCompositeResult extends TargetResultFields, ReleaseFields {
  status: 'released';
  kind: 'composite';
  /**
   * Count of commits that yield at least one changelog item; `0` when the unreleased window does
   * not contain any commits or when none does.
   */
  parsedCommitCount: number;
  releaseType: ReleaseType;
  /** Raw commits of the composite's commit window since its last tag. */
  commits: Commit[];
}

/** Result of a composite target that skips: the diagnostic fields and a human-readable `skipReason`. */
export interface SkippedCompositeResult extends TargetResultFields {
  status: 'skipped';
  kind: 'composite';
  /**
   * Count of commits that yield at least one changelog item; `0` when the unreleased window does not contain any
   * commits or when none does.
   */
  parsedCommitCount: number;
  skipReason: string;
}

/** Result of preparing a package target, discriminated by `status`. */
export type PackagePrepareResult = ReleasedPackageResult | SkippedPackageResult;

/** Result of preparing a directory target, discriminated by `status`. */
export type DirectoryPrepareResult = ReleasedDirectoryResult | SkippedDirectoryResult;

/** Result of preparing a composite target, discriminated by `status`. */
export type CompositePrepareResult = ReleasedCompositeResult | SkippedCompositeResult;

/** Result of preparing one release target, discriminated by `kind` and by `status`. */
export type TargetPrepareResult = PackagePrepareResult | DirectoryPrepareResult | CompositePrepareResult;

/** Result of a target that releases, of any kind. */
export type ReleasedTargetResult = ReleasedPackageResult | ReleasedDirectoryResult | ReleasedCompositeResult;

/** Aggregate result of the prepare workflow over a run's targets. */
export interface PrepareResult {
  /** One result per target that the run prepared: the package targets in config order, then the composites. */
  targets: TargetPrepareResult[];
  tags: string[];
  formatCommand?:
    | {
        command: string;
        files: string[];
      }
    | undefined;
  /** Warnings reported during preparation (e.g., circular dependency detection). */
  warnings?: string[] | undefined;
}

/** Configuration for a single work type used in commit categorization. */
export interface WorkTypeConfig {
  /** Human-readable label for the section heading in changelogs. */
  header: string;
  /** Optional aliases that map to this work type (e.g., 'feature' -> 'feat'). */
  aliases?: string[] | undefined;
  /**
   * Keeps commits and change-record entries of this type out of every changelog. They do not yield
   * any item, so they contribute nothing to the version bump, and the release report does not
   * list them as unparseable.
   */
  excludedFromChangelog?: boolean | undefined;
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
// Defined in zod so that the runtime validator and the static type stay in lockstep: `z.infer`
// derives each type from its schema. Schemas describe the *input* shape (fields optional, no
// defaults). Resolved shapes (`ChangelogJsonConfig`, `ReleaseNotesConfig`, `WorkspaceConfig`,
// etc.) are hand-written interfaces, because config merging produces them after applying
// defaults and they do not need any validation.

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
 * A single historical identity snapshot for a workspace. Both fields are required, because a full
 * tuple stays unambiguous across any number of renames.
 */
export type LegacyIdentity = z.infer<typeof legacyIdentitySchema>;

/**
 * Schema for a package that once lived in this repo but has since been extracted or removed.
 *
 * Unlike `legacyIdentitySchema`, retired packages are never consulted for baseline lookup
 * or changelog attribution; they acknowledge historical tag prefixes and suppress
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
    paths: z.array(z.string().min(1)).min(1).optional(),
    tagPrefix: z.string().min(1).optional(),
  })
  .strict();

/** Consumer-facing project-release config (`project` block). Empty object opts in to project releases. */
export type ProjectConfig = z.infer<typeof projectConfigSchema>;

/**
 * Schema for a `releases` entry that names the target at `path`: the discovered workspace there, or otherwise the
 * directory, whose `tagPrefix` defaults to its basename followed by `-v`.
 */
export const pathReleaseSchema = z
  .object({
    path: z.string().min(1),
    tagPrefix: z.string().min(1).optional(),
    legacyIdentities: z.array(legacyIdentitySchema).optional(),
  })
  .strict();

/** A `releases` entry that names the discovered workspace or the directory at `path`. */
export type PathRelease = z.infer<typeof pathReleaseSchema>;

/** Schema for a `releases` entry that declares a composite of the named targets. */
export const compositeReleaseSchema = z
  .object({
    includes: z.array(z.string().min(1)).min(1),
    tagPrefix: z.string().min(1).optional(),
  })
  .strict();

/** A `releases` entry that declares a composite of the named targets, versioned by the root `package.json`. */
export type CompositeRelease = z.infer<typeof compositeReleaseSchema>;

/**
 * Schema for one `releases` entry: `false` excludes the discovered workspace of that name, and the object shapes name
 * a workspace or a directory, or declare the composite. `validateConfig` relies on this branch order to report a failed entry.
 */
export const releaseEntrySchema = z.union([z.literal(false), pathReleaseSchema, compositeReleaseSchema]);

/** One `releases` entry, keyed in the config by the target's name. */
export type ReleaseEntry = z.infer<typeof releaseEntrySchema>;

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
    excludedFromChangelog: z.boolean().optional(),
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
export const breakingPolicyValueSchema = z.enum(['forbidden', 'optional'] satisfies BreakingPolicy[]);

/** Schema for a single label's spec in the `repoLabels.labels` record. */
export const labelSpecSchema = z
  .object({
    color: z.string().min(1),
    description: z.string().optional(),
    aliases: z.array(z.string().min(1)).min(1).optional(),
    archived: z.literal(true).optional(),
  })
  .strict();

/**
 * A label's color, optional description, optional aliases, and optional archived mark; the name is the record key in
 * `repoLabels.labels`. An omitted description resolves to empty, which the generated labels file declares explicitly
 * so that a sync clears whatever description the label has on the repo. Each alias names an existing label that the
 * sync renames to this one in place, keeping it on the issues and pull requests that have it. `archived: true` retires
 * the label: The sync archives it, keeping it on the issues and pull requests that have it.
 */
export type LabelSpec = z.infer<typeof labelSpecSchema>;

/**
 * Schema for the optional `repoLabels` block, which declares the repository's label registry (the labels defined on
 * the GitHub repo, distinct from labels applied to PRs and issues).
 *
 * Resolution is an ordered fold with last-writer-wins: presets in `extends` order, then the `labels` record,
 * in which an entry adds a label, replaces one that an earlier layer defined, or removes it (`null`). Names match
 * case-insensitively, as GitHub matches them, and the replacing layer's spelling wins.
 * Three misstatements are resolve-time errors (`resolveLabels`), not schema errors: `labels` keys that differ only in
 * case, a `null` naming a label not defined by any earlier layer, and an alias that names a resolved label or repeats
 * another alias.
 */
export const repoLabelsSchema = z
  .object({
    extends: z.array(z.string().min(1)).optional(),
    labels: z.record(z.string().min(1), labelSpecSchema.nullable()).optional(),
  })
  .strict();

/** Consumer-facing `repoLabels` block: bundled presets to extend plus per-name adjustments. */
export type RepoLabelsConfig = z.infer<typeof repoLabelsSchema>;

/** Schema for the consumer-facing config file shape (`.config/release-kit.config.ts`). */
export const releaseKitConfigSchema = z
  .object({
    breakingPolicies: z.record(z.string(), breakingPolicyValueSchema).optional(),
    changelogJson: changelogJsonInputSchema.optional(),
    formatCommand: z.string().min(1).optional(),
    project: projectConfigSchema.optional(),
    releaseNotes: releaseNotesInputSchema.optional(),
    releases: z.record(z.string().min(1), releaseEntrySchema).optional(),
    repoLabels: repoLabelsSchema.optional(),
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
  /** The commit message, subject and body together. */
  message: string;
  /** The first line of the commit message. */
  subject: string;
  /** The commit hash. */
  hash: string;
}

/** A commit that has been parsed to extract structured metadata. */
export interface ParsedCommit {
  /** The original commit message, subject and body together. */
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

/** A directory that a `releases` entry declares as a release target, as config merging resolves it. */
export interface DirectoryConfig {
  /** Name of the release target, its `releases` entry key. */
  name: string;
  /** Repo-relative POSIX path of the directory; `.` for the repo root. */
  path: string;
  /** Repo-relative JSON file whose `version` field the release bumps: the directory's `package.json` or `version.json`. */
  versionFile: string;
  /** Git pathspecs of the commit window; `undefined` for the repo root, whose window is the whole repo. */
  paths?: string[];
  tagPrefix: string;
  /** Prior identities, whose tag prefixes are searched alongside `tagPrefix`; `undefined` equals the empty array. */
  legacyIdentities?: LegacyIdentity[];
}

/** Per-workspace configuration for monorepo releases. */
export interface WorkspaceConfig {
  /** The package directory name (e.g., 'arrays'), which names the workspace's release target by default. */
  dir: string;
  /** Name of the workspace's release target when a `releases` entry renames it; `undefined` means `dir`. */
  targetName?: string;
  /** The full scoped npm name from `package.json` (e.g., `'@williamthorsen/nmr-core'`). */
  name: string;
  /** The git tag prefix for this workspace (e.g., 'nmr-core-v'), derived from the unscoped `package.json` name. */
  tagPrefix: string;
  /** Repo-relative path to the package root (e.g., `packages/core`). */
  workspacePath: string;
  /**
   * Whether this workspace can be published to a registry. `true` when `package.json#private`
   * is absent or `false`; `false` only when `private === true`.
   */
  isPublishable: boolean;
  /** Paths to package.json files to bump. */
  packageFiles: string[];
  /** Glob patterns passed to `git log -- <paths>` for commit filtering. */
  paths: string[];
  /**
   * Prior identities of this workspace.
   * Each identity's `tagPrefix` is consulted in addition to the current `tagPrefix` when searching for baseline
   * tags and generating changelogs. `undefined` is equivalent to the empty array.
   */
  legacyIdentities?: LegacyIdentity[];
}

/** Release settings that every target of a run shares, as config merging resolves them. */
export interface ReleaseSettings {
  /** Work type configurations. Defaults to `DEFAULT_WORK_TYPES`. */
  workTypes?: Record<string, WorkTypeConfig>;
  /** Version bump patterns. Defaults to `DEFAULT_VERSION_PATTERNS`. */
  versionPatterns?: VersionPatterns;
  /**
   * Per-canonical-type breaking-policy lookup. Defaults to `DEFAULT_BREAKING_POLICIES`. When
   * provided, replaces the default entirely. Pass `{}` to disable enforcement (parser falls
   * back to `'optional'` for missing types).
   */
  breakingPolicies?: Record<string, BreakingPolicy>;
  /**
   * Shell command to run after changelog generation (e.g., 'pnpm run fmt').
   * Modified file paths (package.json files and CHANGELOGs) are appended as space-separated arguments.
   * Paths are repo-relative; file paths containing spaces are not supported.
   */
  formatCommand?: string;
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

/** Fields that every kind of release target declares. */
interface ReleaseTargetBase {
  /** Selects the target, as `--only` does; never a source of tag names. */
  id: string;
  /** Prefix of the target's version tags (e.g., `'nmr-core-v'`). */
  tagPrefix: string;
  /** Prior identities, whose tag prefixes are searched alongside `tagPrefix`; `undefined` equals the empty array. */
  legacyIdentities?: LegacyIdentity[];
  /** Repo-relative files whose `version` field the release bumps. */
  versionFiles: string[];
  /** Repo-relative directory that contains the target's `CHANGELOG.md` and changelog JSON. */
  changelogDir: string;
  /** Git pathspecs that bound the target's commit window; `undefined` reads the whole repo. */
  paths?: string[];
  /** Whether a release of the target publishes to a registry. */
  isPublishable: boolean;
}

/** A releasable package: a workspace of a monorepo, or the root of a single-package repo. */
export interface PackageTarget extends ReleaseTargetBase {
  kind: 'package';
  /** The npm name from `package.json`; undefined for the single-package root. */
  packageName?: string;
  /** Repo-relative path to the package root (e.g., `packages/core`, or `.` for the single-package root). */
  packagePath: string;
  /** Whether the target is a monorepo workspace, whose change-record entries route by scope to its `id`. */
  isWorkspace: boolean;
}

/** A releasable directory that isn't a workspace, versioned by its `package.json` or `version.json`. */
export interface DirectoryTarget extends ReleaseTargetBase {
  kind: 'directory';
  /** Repo-relative path to the directory; `.` for the repo root, whose window is the whole repo. */
  directoryPath: string;
}

/** A release that rolls up other targets, such as the project release of a monorepo. */
export interface CompositeTarget extends ReleaseTargetBase {
  kind: 'composite';
  /** Ids of the package and directory targets that the composite rolls up. */
  members: string[];
}

/** One releasable thing, whatever shape of config declared it. */
export type ReleaseTarget = PackageTarget | DirectoryTarget | CompositeTarget;

/** Configuration for a monorepo release workflow with multiple workspaces. */
export interface MonorepoReleaseConfig extends ReleaseSettings {
  /** Ordered list of workspace configurations. */
  workspaces: WorkspaceConfig[];
  /** Discovered workspaces that the config excludes, which tag resolution still matches; `undefined` means none. */
  excludedWorkspaces?: WorkspaceConfig[];
  /** Directories that the `releases` block declares as targets, in config order; `undefined` means none. */
  directories?: DirectoryConfig[];
  /**
   * Project-level release config. Present when the config declares a `project` block, in which case
   * `prepare` runs a project-release stage after the per-workspace loop.
   */
  project?: ResolvedProjectConfig;
}
