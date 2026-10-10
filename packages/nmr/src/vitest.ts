import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultExclude, mergeConfig, type TestProjectInlineConfiguration, type ViteUserConfig } from 'vitest/config';
import type { InlineConfig, ProjectConfig } from 'vitest/node';

import { listGitIgnoredPaths } from './git-ignored-paths.ts';
import { isObject } from './helpers/type-guards.ts';
import { ALL_TEST_PATTERNS, buildTierPatterns, TEST_COLLECTION_EXCLUDE, TIER_NAMES, type TierName } from './tiers.ts';
import { createSourceResolutionPlugin } from './vitest-source-resolution.ts';
import { getWorkspacePackageDirs } from './workspace.ts';
import { toWorkspacePackageGlobs } from './workspace-globs.ts';

export type { TierName } from './tiers.ts';

/**
 * Test options that Vitest honours only at the root of a `projects` config. Derived from Vitest's own types, so an
 * option that changes scope in a later release changes scope here too.
 */
export type RootTestOptions = Omit<InlineConfig, keyof ProjectConfig>;

/** Root-scoped overrides: Vite-level options plus the test options that survive at the root. */
export type RootOverrides = Omit<ViteUserConfig, 'test'> & { test?: RootTestOptions };

export interface VitestConfigOptions {
  /**
   * Merged into the root config, which every project inherits because each declares `extends: true`.
   *
   * `resolve` is per-environment. Vitest resolves a test's own imports through the server environment, so a
   * condition meant for them goes under `ssr`; a top-level `resolve.conditions` entry applies to the client
   * environment, which only browser-mode tests resolve through.
   */
  root?: RootOverrides;

  /** Merged into every declared project. This is where per-project options such as `setupFiles` go. */
  project?: ProjectConfig;

  /**
   * Merged into one tier's project alone, after this layer's `project` block. Raising a budget for `tool` here
   * leaves `unit` on the tight default that makes a hung unit test fail fast, which a uniform `project` override
   * would flatten.
   */
  tiers?: Partial<Record<TierName, ProjectConfig>>;

  /**
   * Directory basenames kept out of every project's collection, additive to the ones that the shared config always
   * prunes and to the paths that git ignores. Each name is matched at any depth, and every layer's entries are
   * concatenated rather than the last winning, matching the config's rule for arrays.
   *
   * The same array declares the scope of nmr's exported test-file conventions check, so the sweep and the
   * collection glob cannot drift. Excluding a directory from the sweep alone leaves a test file that runs and
   * reports nothing; excluding it from collection alone leaves a report that a consumer cannot act on. A repo wanting
   * a glob rather than a directory name has the `project` seam's own `exclude`.
   */
  testCollectionExclude?: readonly string[];

  /**
   * Loads nmr's git-isolation setup file into every project, ahead of any that the layers supply. Defaults to `true`.
   * Turn it off only when a suite is meant to read the developer's own git configuration.
   */
  shouldIsolateGit?: boolean;

  /**
   * Resolves a package whose files are outside every `node_modules` through its `source` export condition, so a
   * suite runs without a prior build. Defaults to `true`. A package that does not declare a `source` condition is
   * unaffected, and so is every package under `node_modules`, which Node resolves and to which the condition never
   * applies.
   */
  shouldResolveFromSource?: boolean;

  /**
   * Resolves a test's aliased specifier through the `paths` that a `tsconfig.json` declares, the way `tsc` does.
   * Defaults to `false`, matching Vite, and requires Vite 8.
   *
   * Without it, an alias fails loudly as an unresolved import. With it, a repo that declares `paths` for `tsc` alone
   * changes which module a specifier reaches, and nothing in the run reports the change. A repo that does not declare
   * `paths` is unaffected either way.
   */
  tsconfigPaths?: boolean;
}

export interface RootVitestConfigOptions extends VitestConfigOptions {
  /**
   * An absolute path to the monorepo root, which must contain `pnpm-workspace.yaml`. A root config is in that
   * directory by construction, so this is `import.meta.dirname`. Stated rather than searched for: Resolving it
   * from the working directory would make the config describe whichever monorepo the run happened to start in.
   */
  monorepoRoot: string;
}

/** Any number of shared layers, then the config file's own, which states the monorepo root. */
type RootConfigLayers = [...(VitestConfigOptions | undefined)[], RootVitestConfigOptions];

// The head of the ladder is the residual: It collects every test file that the named tiers do not claim, including
// a file whose infix does not match any tier.
const [RESIDUAL_TIER, ...NAMED_TIERS] = TIER_NAMES;

const TIERED_PATTERNS = NAMED_TIERS.flatMap(buildTierPatterns);

/**
 * Timeout for every tier above `unit`, whose tests wait on something they don't control. Vitest's defaults are
 * unit-test budgets -- 5s for a test, 10s for a hook -- and a test that drives a compiler already approaches the
 * first, while coverage instrumentation roughly quadruples the wall time.
 *
 * One value covers both budgets. A tier that scaffolds in `beforeAll` for speed moves that wait out from under
 * `testTimeout` entirely, so raising the test budget alone leaves the slowest operation on the unit-test default.
 *
 * A per-project value rather than a root one, so that the fast tier keeps the tight budget that makes a hung unit test
 * fail quickly. The `project` seam merges over this and applies to every project at once; the `tiers` seam targets one.
 */
const TIER_TIMEOUT_MS = 30_000;

/**
 * nmr's git-isolation setup file, resolved beside this module and with this module's own extension, so that a
 * consumer importing the compiled `.js` twin and nmr's own tests importing this file as `.ts` both resolve to a
 * file that exists.
 */
const GIT_ISOLATION_SETUP_FILE = resolveGitIsolationSetupFile();

// Vite's own defaults for each environment. Because Vite lets a supplied `conditions` array replace its defaults
// rather than extend them, emitting them here keeps `module` reachable once a layer adds a condition of its own: A
// dependency exposing a `module` entry otherwise falls through to whatever its `exports` lists next.
//
// A replaced list still resolves `node` and `development` under Vitest, so only a dependency exposing a `module`
// entry distinguishes a complete list from a narrowed one, and the fixtures here do not include one.
// `vitest.unit.test.ts` pins both against `vite`'s own exports, which keeps them complete. Hardcoded rather than read
// from `vite`, which nmr would otherwise have to declare as a peer dependency for every consumer to satisfy.
//
// The lists omit the `source` condition, which `createSourceResolutionPlugin` resolves; its description says why.
const CLIENT_CONDITIONS = ['module', 'browser', 'development|production'];
const SERVER_CONDITIONS = ['module', 'node', 'development|production'];

// Fixtures are excluded from coverage but never from collection: A coverage exclude cannot hide a real test, while a
// collection exclude could hide one legitimately placed under `fixtures/`. `__snapshots__` does not need an entry
// because `.snap` files never match the include.
//
// Each entry names what cannot contain runtime code by construction: a directory, a barrel, a declaration file.
const COVERAGE_EXCLUDE = ['**/__{fixtures,mocks,tests}__/**', '**/index.ts', '**/*.d.ts'];

const PACKAGE_COVERAGE_INCLUDE = ['**/src/**/*.{ts,tsx}'];

/** Characters that picomatch reads as pattern syntax, escaped so that a literal path stays literal. */
const GLOB_SYNTAX_PATTERN = /[!()*+?@[\]{}]/g;

/**
 * Every option key that the factories honour, stored as a record so that an option added to `VitestConfigOptions`
 * without an entry here fails to compile rather than being rejected at run time as unrecognized.
 */
const RECOGNIZED_OPTIONS: Record<keyof VitestConfigOptions, true> = {
  project: true,
  root: true,
  shouldIsolateGit: true,
  shouldResolveFromSource: true,
  testCollectionExclude: true,
  tiers: true,
  tsconfigPaths: true,
};

/** The base set, plus the root option that only a root config's final layer states. */
const RECOGNIZED_ROOT_OPTIONS: Record<keyof RootVitestConfigOptions, true> = {
  ...RECOGNIZED_OPTIONS,
  monorepoRoot: true,
};

const RECOGNIZED_OPTION_KEYS = Object.keys(RECOGNIZED_OPTIONS);
const RECOGNIZED_ROOT_OPTION_KEYS = Object.keys(RECOGNIZED_ROOT_OPTIONS);

/** Maps each retired option key to the key that replaced it. */
const RETIRED_OPTION_KEYS: ReadonlyMap<string, string> = new Map([
  ['isolateGit', 'shouldIsolateGit'],
  ['resolveFromSource', 'shouldResolveFromSource'],
]);

const MISSING_MONOREPO_ROOT =
  'defineRootVitestConfig requires `monorepoRoot`, an absolute path to the directory that contains pnpm-workspace.yaml. Pass `import.meta.dirname` in the last options layer, from the root config.';

/**
 * Builds the shared Vitest config for a workspace package, declaring the `unit`, `tool`, `localhost`, and `remote`
 * projects. Select them at run time with `--project`, which unions when repeated and accepts negation.
 *
 * Layers fold left to right, later winning and arrays composing, so a config file shares settings by passing a
 * layer ahead of its own. Merging two of this function's *outputs* is not the way: Both declare the same four
 * project names, which Vitest rejects at startup.
 *
 * An `undefined` layer is skipped, which lets `defineVitestConfig(shared, isCI ? ciLayer : undefined)` compose.
 */
export function defineVitestConfig(...layers: (VitestConfigOptions | undefined)[]): ViteUserConfig {
  assertOptionKeys(layers, RECOGNIZED_OPTION_KEYS);

  // Vitest's default root, against which each project's patterns resolve. nmr runs Vitest from the package
  // directory; a run given `--root` elsewhere would match these excludes against a different tree.
  return buildConfig(layers, { coverageInclude: PACKAGE_COVERAGE_INCLUDE, ignoredPathsRoot: process.cwd() });
}

/**
 * Builds the shared Vitest config for repo-root tests. Excludes every workspace package from all projects, and
 * does not report any coverage of its own; packages cover their own sources.
 *
 * `monorepoRoot` is set on the last layer, which is the config file's own: A shared layer describes settings, not
 * which repo they belong to, and only the root config's `import.meta.dirname` states this one. The guard below
 * still catches the JavaScript config that type checking never covers.
 */
export function defineRootVitestConfig(...layers: RootConfigLayers): ViteUserConfig {
  // Reading through `unknown` keeps the check live: The declared type alone would make it statically dead. A relative
  // path would resolve against the working directory, which this option exists to avoid.
  const lastLayer: unknown = layers.at(-1);
  const monorepoRoot: unknown = isObject(lastLayer) ? lastLayer['monorepoRoot'] : undefined;

  if (typeof monorepoRoot !== 'string' || !path.isAbsolute(monorepoRoot)) {
    throw new TypeError(MISSING_MONOREPO_ROOT);
  }

  assertOptionKeys(layers, RECOGNIZED_ROOT_OPTION_KEYS);

  return buildConfig(layers, {
    coverageInclude: [],
    ignoredPathsRoot: monorepoRoot,
    projectExclude: toWorkspacePackageGlobs(monorepoRoot, getWorkspacePackageDirs(monorepoRoot)),
    projectRoot: monorepoRoot,
  });
}

interface BuildOptions {
  coverageInclude: string[];
  /** The directory whose git-ignored paths every project excludes: the root against which its patterns resolve. */
  ignoredPathsRoot: string;
  projectExclude?: string[];
  projectRoot?: string;
}

/** Builds the root config and its tier projects from the non-empty layers, then merges each layer's `root` over it. */
function buildConfig(
  declaredLayers: readonly (VitestConfigOptions | undefined)[],
  { coverageInclude, ignoredPathsRoot, projectExclude = [], projectRoot }: BuildOptions,
): ViteUserConfig {
  // Dropping the empty layers here rather than at each fold keeps every consumer of `layers` below total.
  const layers = declaredLayers.filter((layer) => layer !== undefined);

  assertKnownTiers(layers);

  // `tsconfigPaths` shares the block, which a second spread would replace rather than merge into, and does not need
  // an `ssr` twin the way the conditions do: Vite keeps it outside its per-environment resolve options and spreads
  // the top-level block into every environment's defaults.
  const resolve = {
    conditions: CLIENT_CONDITIONS,
    ...(resolveFlag(layers, 'tsconfigPaths', false) && { tsconfigPaths: true }),
  };

  const config: ViteUserConfig = {
    ...(resolveFlag(layers, 'shouldResolveFromSource', true) && { plugins: [createSourceResolutionPlugin()] }),
    resolve,
    ssr: { resolve: { conditions: SERVER_CONDITIONS } },
    test: {
      coverage: {
        enabled: false, // don't check coverage unless the `--coverage` flag is passed
        exclude: COVERAGE_EXCLUDE,
        include: coverageInclude,
        provider: 'v8',
      },
      passWithNoTests: true, // `nmr test:tool` fans out over packages without any tool-tier tests
      projects: buildProjects(layers, projectExclude, projectRoot, ignoredPathsRoot),
      silent: 'passed-only', // see logs from failing tests only
      watch: false, // don't enter watch mode unless the `--watch` flag is passed
    },
  };

  let mergedConfig = config;
  for (const { root } of layers) {
    if (root) mergedConfig = mergeConfig(mergedConfig, root);
  }

  return mergedConfig;
}

/** One project's definition before it becomes a Vitest project config: the residual, then every named tier. */
interface ProjectTier {
  exclude: string[];
  include: string[];
  name: TierName;
  /** Budget for `hookTimeout` and `testTimeout` alike, stored as one field so that the two cannot drift apart. */
  timeoutMs?: number;
}

/** Builds one project per tier, in ladder order, each inheriting the root config. */
function buildProjects(
  layers: readonly VitestConfigOptions[],
  extraExclude: string[],
  projectRoot: string | undefined,
  ignoredPathsRoot: string,
): TestProjectInlineConfiguration[] {
  const projectTiers: ProjectTier[] = [
    { exclude: TIERED_PATTERNS, include: ALL_TEST_PATTERNS, name: RESIDUAL_TIER },
    ...NAMED_TIERS.map((tier) => ({
      exclude: [],
      include: buildTierPatterns(tier),
      name: tier,
      timeoutMs: TIER_TIMEOUT_MS,
    })),
  ];

  const collectionExclude = buildCollectionExclude(layers, ignoredPathsRoot);
  const shouldIsolateGit = resolveFlag(layers, 'shouldIsolateGit', true);

  return projectTiers.map(({ exclude, include, name, timeoutMs }) => {
    const project: TestProjectInlineConfiguration = {
      // Without this, Vitest does not give the project any Vite config file at all, so root-level options such as
      // `resolve.conditions` never apply to it.
      extends: true,
      // Patterns resolve against the project root, which otherwise defaults to the working directory.
      ...(projectRoot !== undefined && { root: projectRoot }),
      test: {
        exclude: [...collectionExclude, ...exclude, ...extraExclude],
        include,
        name,
        ...(shouldIsolateGit && { setupFiles: [GIT_ISOLATION_SETUP_FILE] }),
        ...(timeoutMs !== undefined && { hookTimeout: timeoutMs, testTimeout: timeoutMs }),
      },
    };

    let mergedProject = project;
    for (const layer of layers) {
      mergedProject = applyLayer(mergedProject, layer, name);
    }

    return mergedProject;
  });
}

/**
 * Applies one layer to one project: its uniform `project` block, then whatever it targets at this tier.
 *
 * Layers apply in sequence rather than being merged with each other first, which keeps each layer's array entries
 * contiguous. A shared `setupFiles` entry therefore precedes every entry that a later layer adds, which matters when
 * the shared entry establishes the environment in which the later ones run.
 */
function applyLayer(
  project: TestProjectInlineConfiguration,
  layer: VitestConfigOptions,
  tier: TierName,
): TestProjectInlineConfiguration {
  const withProject = layer.project ? mergeConfig(project, { test: layer.project }) : project;
  const targetedOverrides = layer.tiers?.[tier];

  return targetedOverrides ? mergeConfig(withProject, { test: targetedOverrides }) : withProject;
}

/**
 * Rejects a `tiers` key that does not name a tier. Ignoring it would leave the suite green on whichever budget the
 * key failed to change, which a consumer cannot self-diagnose.
 */
function assertKnownTiers(layers: readonly VitestConfigOptions[]): void {
  const knownTiers: readonly string[] = TIER_NAMES;

  for (const { tiers } of layers) {
    const declaredTiers = Object.keys(tiers ?? {});
    for (const name of declaredTiers) {
      if (!knownTiers.includes(name)) {
        throw new TypeError(`Unknown tier "${name}" in \`tiers\`. Valid tiers: ${TIER_NAMES.join(', ')}.`);
      }
    }
  }
}

/**
 * Rejects an option key that a release renamed, naming its replacement. Runs ahead of the recognized-key check, so
 * that the error for an old spelling names the new one rather than the whole recognized set.
 */
function assertNoRetiredOptions(layer: VitestConfigOptions): void {
  for (const key of Object.keys(layer)) {
    const replacement = RETIRED_OPTION_KEYS.get(key);
    if (replacement !== undefined) {
      throw new TypeError(`Invalid Vitest config: \`${key}\` was renamed to \`${replacement}\`.`);
    }
  }
}

/**
 * Rejects an option key outside the recognized set, and an old spelling of a renamed one. `resolveFlag` and the
 * folds below read each layer by key, so an unrecognized key makes a setting that nothing applies.
 *
 * Only the last layer may state `monorepoRoot`, which `defineRootVitestConfig` reads from that layer alone;
 * recognizing it on every layer would accept it where nothing reads it, which is the failure that this guard prevents.
 */
function assertOptionKeys(
  layers: readonly (VitestConfigOptions | undefined)[],
  lastLayerKeys: readonly string[],
): void {
  const lastIndex = layers.length - 1;

  layers.forEach((layer, index) => {
    if (layer === undefined) return;

    assertNoRetiredOptions(layer);

    const recognizedKeys = index === lastIndex ? lastLayerKeys : RECOGNIZED_OPTION_KEYS;
    const unrecognizedKeys = Object.keys(layer).filter((key) => !recognizedKeys.includes(key));
    if (unrecognizedKeys.length === 0) return;

    throw new TypeError(
      `Invalid Vitest config: unrecognized ${unrecognizedKeys.length === 1 ? 'option' : 'options'} ` +
        `${formatOptionKeys(unrecognizedKeys)}. Recognized: ${formatOptionKeys(recognizedKeys)}.`,
    );
  });
}

/**
 * Builds the collection exclusions that every project applies: Vitest's own defaults, the directories that the shared
 * config always prunes, and whatever the layers add, each directory name as a glob matching at any depth. Then the
 * paths that git ignores under `ignoredPathsRoot`, each anchored to it, since git reports every depth itself; the
 * test-file sweeps skip the same paths.
 *
 * Unioned with Vitest's defaults so that a later release's addition still applies to every project. `dist/` is
 * excluded from collection but not from coverage: A stale test copy under it passes green, which a consumer cannot
 * self-diagnose, whereas a `dist/` entry in the coverage report is a visible 0% that a consumer can.
 */
function buildCollectionExclude(layers: readonly VitestConfigOptions[], ignoredPathsRoot: string): string[] {
  const declaredDirs = layers.flatMap((layer) => layer.testCollectionExclude ?? []);
  const globs = [...TEST_COLLECTION_EXCLUDE, ...declaredDirs].map((dir) => `**/${dir}/**`);
  const ignoredGlobs = listGitIgnoredPaths(ignoredPathsRoot).map(buildIgnoredPathGlob);

  return [...new Set([...defaultExclude, ...globs, ...ignoredGlobs])];
}

/** Turns one git-ignored path into an exclude glob: everything beneath a `dir/` entry, or the file itself. */
function buildIgnoredPathGlob(ignoredPath: string): string {
  const escapedPath = ignoredPath.replaceAll(GLOB_SYNTAX_PATTERN, String.raw`\$&`);

  return escapedPath.endsWith('/') ? `${escapedPath}**` : escapedPath;
}

/** Renders option keys as a sorted, backtick-quoted list. */
function formatOptionKeys(keys: readonly string[]): string {
  return keys
    .toSorted()
    .map((key) => `\`${key}\``)
    .join(', ');
}

/**
 * Reads one boolean option across the layers, the last to declare it winning, and the caller's default when none
 * does. Each call site states its own default, so a flag cannot inherit one chosen for a different flag.
 */
function resolveFlag(
  layers: readonly VitestConfigOptions[],
  name: 'shouldIsolateGit' | 'shouldResolveFromSource' | 'tsconfigPaths',
  isOnByDefault: boolean,
): boolean {
  let resolvedFlag = isOnByDefault;

  for (const layer of layers) {
    const declaredFlag = layer[name];
    if (declaredFlag !== undefined) resolvedFlag = declaredFlag;
  }

  return resolvedFlag;
}

/**
 * Locates the setup file published beside this module. The extension is read from the resolved filesystem path
 * rather than from `import.meta.url`, which Vite may supply with a version query appended.
 */
function resolveGitIsolationSetupFile(): string {
  const thisFile = fileURLToPath(import.meta.url);

  return path.join(path.dirname(thisFile), `vitest-git-isolation${path.extname(thisFile)}`);
}
