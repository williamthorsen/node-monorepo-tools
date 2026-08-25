import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TestProjectInlineConfiguration, ViteUserConfig } from 'vitest/config';
import { defaultExclude, mergeConfig } from 'vitest/config';
import type { InlineConfig, ProjectConfig } from 'vitest/node';

import { isObject } from './helpers/type-guards.ts';
import type { TierName } from './tiers.ts';
import { ALL_TEST_PATTERNS, buildTierPatterns, TEST_COLLECTION_EXCLUDE, TIER_NAMES } from './tiers.ts';
import { getWorkspacePackageDirs } from './workspace.ts';

export type { TierName } from './tiers.ts';

/**
 * Test options Vitest honours only at the root of a `projects` config. Derived from Vitest's own types rather than
 * hand-listed, so an option that changes scope in a later release changes scope here too.
 */
export type RootTestOptions = Omit<InlineConfig, keyof ProjectConfig>;

/** Root-scoped overrides: Vite-level options plus the test options that survive at the root. */
export type RootOverrides = Omit<ViteUserConfig, 'test'> & { test?: RootTestOptions };

export interface VitestConfigOptions {
  /**
   * Merged into the root config, which every project inherits because each declares `extends: true`.
   *
   * `resolve` is per-environment. Vitest resolves a test's own imports through the server environment, so a
   * condition meant for them goes under `ssr`; a top-level `resolve.conditions` entry reaches the client
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
   * Directory basenames kept out of every project's collection, additive to the ones the shared config always
   * prunes. Each name is matched at any depth, and every layer's entries are concatenated rather than the last
   * winning, matching the config's rule for arrays.
   *
   * The same array declares the scope of nmr's exported test-file conventions check, so the sweep and the
   * collection glob cannot drift. Excluding a directory from the sweep alone leaves a test file that runs and
   * reports nothing; excluding it from collection alone leaves a report a consumer cannot act on. A repo wanting
   * a glob rather than a directory name has the `project` seam's own `exclude`.
   */
  testCollectionExclude?: readonly string[];

  /**
   * Loads nmr's git-isolation setup file into every project, ahead of any the layers supply. Defaults to `true`.
   * Turn it off only where a suite is meant to read the developer's own git configuration.
   */
  isolateGit?: boolean;

  /**
   * Resolves workspace packages through their `source` export condition, so a suite runs without a prior build.
   * Defaults to `true`. A package declaring no such condition is unaffected.
   */
  resolveFromSource?: boolean;

  /**
   * Resolves a specifier through the `paths` a `tsconfig.json` declares, so a test reaches an alias the way `tsc`
   * does. Defaults to `false`, matching Vite, and requires Vite 8.
   *
   * Not a default, because both directions are safe to leave to the consumer: omitting it fails loudly with an
   * unresolved import, while turning it on for a repo that declares `paths` for `tsc` alone changes which module a
   * specifier reaches with nothing in the run reporting it. A repo declaring no `paths` is unaffected either way.
   */
  tsconfigPaths?: boolean;
}

export interface RootVitestConfigOptions extends VitestConfigOptions {
  /**
   * An absolute path to the monorepo root, which must hold `pnpm-workspace.yaml`. A root config sits at that
   * directory by construction, so this is `import.meta.dirname`. Stated rather than searched for: resolving it
   * from the working directory would make the config describe whichever monorepo the run happened to start in.
   */
  monorepoRoot: string;
}

/** Any number of shared layers, then the config file's own, which states the monorepo root. */
type RootConfigLayers = [...(VitestConfigOptions | undefined)[], RootVitestConfigOptions];

// The head of the ladder is the residual: it collects every test file the named tiers don't claim, so a file whose
// infix matches no tier still runs rather than being dropped by an allow-list.
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
 * A per-project value rather than a root one, so the fast tier keeps the tight budget that makes a hung unit test
 * fail quickly. The `project` seam merges over this and reaches every project at once; the `tiers` seam targets one.
 */
const TIER_TIMEOUT = 30_000;

/**
 * nmr's git-isolation setup file, resolved beside this module and carrying this module's own extension, so a
 * consumer reaching the compiled `.js` twin and nmr's own tests importing this file as `.ts` both land on a file
 * that exists.
 */
const GIT_ISOLATION_SETUP_FILE = resolveGitIsolationSetupFile();

// The `source` condition, then Vite's own defaults for each environment. Vite lets a supplied `conditions` array
// replace its defaults rather than extend them, so emitting them here is what keeps `module` reachable: a
// dependency exposing a `module` entry otherwise falls through to whatever its `exports` lists next.
//
// A replaced list still resolves `node` and `development` under Vitest, so only a dependency exposing a `module`
// entry distinguishes a complete list from a narrowed one, and no fixture here has one. `vitest.unit.test.ts`
// pins both against `vite`'s own exports, which is what holds them complete. Hardcoded rather than read from
// `vite`, which nmr would otherwise have to declare as a peer dependency for every consumer to satisfy.
const SOURCE_CLIENT_CONDITIONS = ['source', 'module', 'browser', 'development|production'];
const SOURCE_SERVER_CONDITIONS = ['source', 'module', 'node', 'development|production'];

// Fixtures are excluded from coverage but never from collection: a coverage exclude cannot hide a real test, while a
// collection exclude could swallow one legitimately placed under `fixtures/`. `__snapshots__` needs no entry because
// `.snap` files never match the include.
//
// Each entry names what cannot hold runtime code by construction: a directory, a barrel, a declaration file.
const COVERAGE_EXCLUDE = ['**/__{fixtures,mocks,tests}__/**', '**/index.ts', '**/*.d.ts'];

const PACKAGE_COVERAGE_INCLUDE = ['**/src/**/*.{ts,tsx}'];

const MISSING_MONOREPO_ROOT =
  'defineRootVitestConfig requires `monorepoRoot`, an absolute path to the directory holding pnpm-workspace.yaml. Pass `import.meta.dirname` in the last options layer, from the root config.';

/**
 * Builds the shared Vitest config for a workspace package, declaring the `unit`, `tool`, `localhost`, and `remote`
 * projects. Select them at run time with `--project`, which unions when repeated and accepts negation.
 *
 * Layers fold left to right, later winning and arrays composing, so a config file shares settings by passing a
 * layer ahead of its own. Merging two of this function's *outputs* is not the way: both declare the same four
 * project names, which Vitest rejects at startup.
 *
 * An `undefined` layer is skipped, so `defineVitestConfig(shared, isCI ? ciLayer : undefined)` composes.
 */
export function defineVitestConfig(...layers: (VitestConfigOptions | undefined)[]): ViteUserConfig {
  return buildConfig(layers, { coverageInclude: PACKAGE_COVERAGE_INCLUDE });
}

/**
 * Builds the shared Vitest config for repo-root tests. Excludes every workspace package from all projects, and
 * reports no coverage of its own — packages cover their own sources.
 *
 * `monorepoRoot` rides on the last layer, which is the config file's own: a shared layer describes settings, not
 * which repo they belong to, and only the root config's `import.meta.dirname` states this one. The guard below
 * still catches the JavaScript config that types never reach.
 */
export function defineRootVitestConfig(...layers: RootConfigLayers): ViteUserConfig {
  // Reading through `unknown` is what keeps the check live: the declared type alone would make it statically
  // dead. A relative path would resolve against the working directory, which is the resolution this option
  // exists to replace.
  const lastLayer: unknown = layers.at(-1);
  const monorepoRoot: unknown = isObject(lastLayer) ? lastLayer['monorepoRoot'] : undefined;

  if (typeof monorepoRoot !== 'string' || !path.isAbsolute(monorepoRoot)) {
    throw new TypeError(MISSING_MONOREPO_ROOT);
  }

  return buildConfig(layers, {
    coverageInclude: [],
    projectExclude: getWorkspaceExcludePatterns(monorepoRoot),
    projectRoot: monorepoRoot,
  });
}

interface BuildOptions {
  coverageInclude: string[];
  projectExclude?: string[];
  projectRoot?: string;
}

function buildConfig(
  declaredLayers: readonly (VitestConfigOptions | undefined)[],
  { coverageInclude, projectExclude = [], projectRoot }: BuildOptions,
): ViteUserConfig {
  // Dropping the empty layers here rather than at each fold keeps every consumer of `layers` below total.
  const layers = declaredLayers.filter((layer) => layer !== undefined);

  assertKnownTiers(layers);

  const resolveFromSource = resolveFlag(layers, 'resolveFromSource', true);

  // Both flags contribute to one `resolve` block, which a second spread would replace rather than merge into.
  // `tsconfigPaths` needs no `ssr` twin the way the conditions do: Vite holds it outside its per-environment
  // resolve options and spreads the top-level block into every environment's defaults.
  const resolve = {
    ...(resolveFromSource && { conditions: SOURCE_CLIENT_CONDITIONS }),
    ...(resolveFlag(layers, 'tsconfigPaths', false) && { tsconfigPaths: true }),
  };

  const config: ViteUserConfig = {
    ...(Object.keys(resolve).length > 0 && { resolve }),
    ...(resolveFromSource && { ssr: { resolve: { conditions: SOURCE_SERVER_CONDITIONS } } }),
    test: {
      coverage: {
        enabled: false, // don't check coverage unless the `--coverage` flag is passed
        exclude: COVERAGE_EXCLUDE,
        include: coverageInclude,
        provider: 'v8',
      },
      passWithNoTests: true, // `nmr test:tool` fans out over packages holding no tool-tier tests
      projects: buildProjects(layers, projectExclude, projectRoot),
      silent: 'passed-only', // see logs from failing tests only
      watch: false, // don't enter watch mode unless the `--watch` flag is passed
    },
  };

  let merged = config;
  for (const { root } of layers) {
    if (root) merged = mergeConfig(merged, root);
  }

  return merged;
}

/** One project's definition before it becomes a Vitest project config: the residual, then every named tier. */
interface ProjectTier {
  exclude: string[];
  include: string[];
  name: TierName;
  /** Budget for `hookTimeout` and `testTimeout` alike, held as one field so the two cannot drift apart. */
  timeout?: number;
}

/** Builds one project per tier, in ladder order, each inheriting the root config. */
function buildProjects(
  layers: readonly VitestConfigOptions[],
  extraExclude: string[],
  projectRoot: string | undefined,
): TestProjectInlineConfiguration[] {
  const projectTiers: ProjectTier[] = [
    { exclude: TIERED_PATTERNS, include: ALL_TEST_PATTERNS, name: RESIDUAL_TIER },
    ...NAMED_TIERS.map((tier) => ({
      exclude: [],
      include: buildTierPatterns(tier),
      name: tier,
      timeout: TIER_TIMEOUT,
    })),
  ];

  const collectionExclude = buildCollectionExclude(layers);
  const isolateGit = resolveFlag(layers, 'isolateGit', true);

  return projectTiers.map(({ exclude, include, name, timeout }) => {
    const project: TestProjectInlineConfiguration = {
      // Without this, Vitest gives the project no Vite config file at all, so root-level options such as
      // `resolve.conditions` never reach it.
      extends: true,
      // Patterns resolve against the project root, which otherwise defaults to the working directory.
      ...(projectRoot !== undefined && { root: projectRoot }),
      test: {
        exclude: [...collectionExclude, ...exclude, ...extraExclude],
        include,
        name,
        ...(isolateGit && { setupFiles: [GIT_ISOLATION_SETUP_FILE] }),
        ...(timeout !== undefined && { hookTimeout: timeout, testTimeout: timeout }),
      },
    };

    let merged = project;
    for (const layer of layers) {
      merged = applyLayer(merged, layer, name);
    }

    return merged;
  });
}

/**
 * Applies one layer to one project: its uniform `project` block, then whatever it targets at this tier.
 *
 * Layers apply in sequence rather than being merged with each other first, which is what keeps each layer's array
 * entries contiguous. A shared `setupFiles` entry therefore precedes every entry a later layer adds — load-bearing
 * where the shared entry establishes the environment the later ones run in.
 */
function applyLayer(
  project: TestProjectInlineConfiguration,
  layer: VitestConfigOptions,
  tier: TierName,
): TestProjectInlineConfiguration {
  const withProject = layer.project ? mergeConfig(project, { test: layer.project }) : project;
  const targeted = layer.tiers?.[tier];

  return targeted ? mergeConfig(withProject, { test: targeted }) : withProject;
}

/**
 * Rejects a `tiers` key naming no tier. Ignoring it would leave the suite green on whichever budget the key failed
 * to change, which a consumer cannot self-diagnose. A tier renamed in a later nmr release is a breaking change that
 * ships with a migration note, so the throw is that migration's signal rather than a surprise.
 */
function assertKnownTiers(layers: readonly VitestConfigOptions[]): void {
  const known: readonly string[] = TIER_NAMES;

  for (const { tiers } of layers) {
    const declaredTiers = Object.keys(tiers ?? {});
    for (const name of declaredTiers) {
      if (!known.includes(name)) {
        throw new TypeError(`Unknown tier "${name}" in \`tiers\`. Valid tiers: ${TIER_NAMES.join(', ')}.`);
      }
    }
  }
}

/**
 * Builds the collection exclusions every project carries: Vitest's own defaults, the directories the shared config
 * always prunes, and whatever the layers add, each directory name as a glob matching at any depth.
 *
 * Unioned with Vitest's defaults so a later release's addition still reaches every project. `dist/` is excluded from
 * collection but deliberately not from coverage: a stale test copy under it passes green, which a consumer cannot
 * self-diagnose, whereas a `dist/` entry in the coverage report is a visible 0% they can.
 */
function buildCollectionExclude(layers: readonly VitestConfigOptions[]): string[] {
  const declared = layers.flatMap((layer) => layer.testCollectionExclude ?? []);
  const globs = [...TEST_COLLECTION_EXCLUDE, ...declared].map((dir) => `**/${dir}/**`);

  return [...new Set([...defaultExclude, ...globs])];
}

/** Resolves each workspace package directory to a glob relative to the monorepo root. */
function getWorkspaceExcludePatterns(monorepoRoot: string): string[] {
  return getWorkspacePackageDirs(monorepoRoot)
    .map((dir) => `${path.relative(monorepoRoot, dir).split(path.sep).join('/')}/**`)
    .toSorted();
}

/**
 * Reads one boolean option across the layers, the last to declare it winning, and the caller's fallback where none
 * does. Each call site states its own fallback, so a flag cannot inherit one chosen for a different flag.
 */
function resolveFlag(
  layers: readonly VitestConfigOptions[],
  name: 'isolateGit' | 'resolveFromSource' | 'tsconfigPaths',
  fallback: boolean,
): boolean {
  let resolved = fallback;

  for (const layer of layers) {
    const declared = layer[name];
    if (declared !== undefined) resolved = declared;
  }

  return resolved;
}

/**
 * Locates the setup file shipped beside this module. The extension is read from the resolved filesystem path
 * rather than from `import.meta.url`, which Vite may hand over carrying a version query.
 */
function resolveGitIsolationSetupFile(): string {
  const thisFile = fileURLToPath(import.meta.url);

  return path.join(path.dirname(thisFile), `vitest-git-isolation${path.extname(thisFile)}`);
}
