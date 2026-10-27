import type { BreakingPolicy } from '@williamthorsen/change-grammar';
import { z } from 'zod';

// Schemas for the consumer-facing config file. Defined in zod so that the runtime validator and the static type stay
// in lockstep: `z.infer` derives each type from its schema. Schemas describe the *input* shape (fields optional, no
// defaults). Resolved shapes (`ChangelogJsonConfig`, `ReleaseNotesConfig`, `WorkspaceConfig`, etc.) are hand-written
// interfaces in `types.ts`, because config merging produces them after applying defaults and they do not need any
// validation.

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

/** Schema for the optional `changelogMarkdown` block (input shape, all fields optional). */
export const changelogMarkdownInputSchema = z
  .object({
    keptVersionCount: z.number().int().min(1).optional(),
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
    changelogMarkdown: changelogMarkdownInputSchema.optional(),
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
