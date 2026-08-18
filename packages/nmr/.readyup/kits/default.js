/** @noformat — @generated. Do not edit. Compiled by rdy. */
/* eslint-disable */
export const __readyupVersion = "0.29.0";


// .readyup/kits/default.ts
import { existsSync, globSync, readdirSync as readdirSync2, readFileSync } from "node:fs";
import { basename, join, sep } from "node:path";
import { defineRdyKit } from "readyup";
import {
  fileContains,
  fileExists,
  hasDevDependency,
  hasMinDevDependencyVersion,
  hasPackageJsonField,
  isRecord,
  readFile,
  readPackageJson
} from "readyup/check-utils";

// src/default-scripts.ts
var GATE_PROJECTS = "--project unit --project tool";
var TYPECHECK_STEP = { run: "typecheck", declinesArgs: true };
var ROOT_TYPECHECK_STEP = { run: "root:typecheck", declinesArgs: true };
var workspaceScripts = {
  build: ["compile"],
  check: [TYPECHECK_STEP, "fmt:check", "lint:check", "test"],
  "check:strict": [TYPECHECK_STEP, "fmt:check", "lint:strict", "test:coverage"],
  clean: "nmr-clean",
  compile: "nmr-compile",
  fix: ["lint", "fmt"],
  "fix:check": ["fmt:check", "lint:check"],
  fmt: "nmr-fmt --write",
  "fmt:check": "nmr-fmt --check",
  lint: "eslint --fix .",
  "lint:check": "eslint .",
  "lint:strict": "strict-lint",
  "report-catalog": "nmr-report-catalog",
  test: `pnpm exec vitest ${GATE_PROJECTS}`,
  "test:all": "pnpm exec vitest",
  "test:coverage": `pnpm exec vitest ${GATE_PROJECTS} --coverage`,
  "test:tool": "pnpm exec vitest --project tool",
  "test:unit": "pnpm exec vitest --project unit",
  "test:watch": `pnpm exec vitest ${GATE_PROJECTS} --watch`,
  typecheck: "tsgo --noEmit",
  // Without `--include-locked`, nothing would be reported in a repo that pins exact version numbers. The
  // command is a string because neither half names an nmr command: both are binaries.
  upgrade: "nmr-report-catalog && nmr-taze --include-locked",
  "view-coverage": "open coverage/index.html"
};
var rootScripts = {
  audit: ["audit:prod", "audit:dev"],
  "audit:dev": "pnpm exec v11y --dev",
  "audit:prod": "pnpm exec v11y --prod",
  build: ["-R build"],
  check: [TYPECHECK_STEP, "fmt:check", "lint:check", "test"],
  "check:strict": [TYPECHECK_STEP, "fmt:check", "lint:strict", "test:coverage"],
  // Excludes the audit, which in CI has a workflow of its own. The build is what the narrowed check runs
  // against, so it declines the arguments rather than being narrowed by them.
  ci: [{ run: "build", declinesArgs: true }, "check:strict"],
  clean: "nmr-clean",
  fix: ["lint", "fmt"],
  "fix:check": ["fmt:check", "lint:check"],
  fmt: "nmr-fmt --write",
  "fmt:check": "nmr-fmt --check",
  lint: "eslint --fix .",
  "lint:check": "eslint .",
  "lint:strict": "strict-lint",
  // The audit costs seconds and `ci` costs minutes, so the cheap gate fails first. The audit reads the
  // dependency tree, which no argument narrowing the code under test says anything about.
  prepush: [{ run: "audit", declinesArgs: true }, "ci"],
  "report-overrides": "nmr-report-overrides",
  "root:check": [ROOT_TYPECHECK_STEP, "fmt:check", "root:lint:check", "root:test"],
  "root:lint": "eslint --fix --ignore-pattern 'packages/**' .",
  "root:lint:check": "eslint --ignore-pattern 'packages/**' .",
  "root:lint:strict": "strict-lint --ignore-pattern 'packages/**' .",
  "root:test": `vitest --config ./vitest.root.config.ts ${GATE_PROJECTS}`,
  "root:test:all": "vitest --config ./vitest.root.config.ts",
  "root:test:tool": "vitest --config ./vitest.root.config.ts --project tool",
  "root:test:unit": "vitest --config ./vitest.root.config.ts --project unit",
  "root:typecheck": "tsgo --noEmit",
  // Carries the override report for the same reason `upgrade` does: both end in the tool that rewrites a
  // `pnpm.overrides` block, so both need the reporter's rejection ahead of them.
  "root:upgrade": "nmr-report-overrides && nmr-taze --include-locked",
  test: ["root:test", "-R test"],
  "test:all": ["root:test:all", "-R test:all"],
  "test:coverage": ["root:test", "-R test:coverage"],
  "test:tool": ["root:test:tool", "-R test:tool"],
  "test:unit": ["root:test:unit", "-R test:unit"],
  "test:watch": `vitest ${GATE_PROJECTS} --watch`,
  // Neither step is narrowable, so `nmr typecheck <file>` is rejected rather than checking that file under
  // default options at the root and hunting for it in every package.
  typecheck: [ROOT_TYPECHECK_STEP, { run: "-R typecheck", declinesArgs: true }],
  // The command is a string because neither half names an nmr command: both are binaries, and a composite
  // element can name only a command.
  upgrade: "nmr-report-overrides && nmr-taze --include-locked --recursive"
};

// src/resolve-scripts.ts
function getDefaultRootScripts() {
  return { ...rootScripts };
}

// src/tiers.ts
import { readdirSync } from "node:fs";
import path from "node:path";
var TEST_DIR = "__tests__";
var TEST_EXTENSIONS = "{ts,tsx}";
var TEST_GLOB_PREFIX = `**/${TEST_DIR}/**`;
var TEST_FILE_PATTERN = /\.test\.tsx?$/;
var ALL_TEST_PATTERNS = [`${TEST_GLOB_PREFIX}/*.test.${TEST_EXTENSIONS}`];
function findTestFiles(rootDir) {
  const found = [];
  collectTestFiles(rootDir, "", false, found);
  return found.toSorted();
}
function hasTierInfix(filePath) {
  const tiers = TIER_NAMES;
  return tiers.includes(path.basename(filePath).split(".").at(-3) ?? "");
}
var TEST_COLLECTION_EXCLUDE = [".git", "coverage", "dist", "node_modules"];
var TIER_NAMES = ["unit", "tool", "localhost", "remote"];
function collectTestFiles(dir, relativeDir, inTestDir, found) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (TEST_COLLECTION_EXCLUDE.includes(entry.name)) continue;
      collectTestFiles(path.join(dir, entry.name), relativePath, inTestDir || entry.name === TEST_DIR, found);
    } else if (inTestDir && TEST_FILE_PATTERN.test(entry.name)) {
      found.push(relativePath);
    }
  }
}

// .readyup/kits/default.ts
var default_default = defineRdyKit({
  checklists: [
    {
      name: "nmr",
      checks: [
        // -- Setup ---------------------------------------------------------------
        {
          name: "@williamthorsen/nmr in devDependencies",
          severity: "error",
          check: () => hasDevDependency("@williamthorsen/nmr"),
          fix: "pnpm add --save-dev @williamthorsen/nmr",
          checks: [
            {
              get name() {
                return `@williamthorsen/nmr >= ${getMinVersion()}`;
              },
              severity: "error",
              check: () => hasMinDevDependencyVersion("@williamthorsen/nmr", getMinVersion(), {
                exempt: resolvesVersionViaWorkspace
              }),
              get fix() {
                return `pnpm add --save-dev @williamthorsen/nmr@^${getMinVersion()}`;
              }
            }
          ]
        },
        {
          name: "pnpm-workspace.yaml exists",
          severity: "error",
          check: () => fileExists("pnpm-workspace.yaml"),
          fix: "Create pnpm-workspace.yaml with workspace package globs"
        },
        {
          name: "package.json has packageManager field",
          severity: "warn",
          check: () => hasPackageJsonField("packageManager"),
          fix: 'Add "packageManager" field to package.json (e.g., "pnpm@10.33.0")'
        },
        {
          name: ".tool-versions does not list pnpm",
          severity: "warn",
          quiet: true,
          check: toolVersionsHasNoPnpm,
          fix: "Remove pnpm from .tool-versions \u2014 manage via packageManager field and corepack"
        },
        {
          name: "no package.json declares a pnpm field",
          severity: "error",
          quiet: true,
          check: () => noPnpmFieldInPackageJson(),
          fix: "Move these settings into pnpm-workspace.yaml, quoting each version under `overrides`, or run `pnpx codemod run pnpm-v10-to-v11`. pnpm 11 reads no key from the `pnpm` field, so an override left there pins nothing while an upgrade run with `--write` goes on rewriting it"
        },
        {
          name: ".config/nmr.config.ts uses defineConfig",
          severity: "recommend",
          skip: () => !fileExists(".config/nmr.config.ts") ? "no nmr config file" : false,
          check: () => fileContains(".config/nmr.config.ts", /defineConfig/),
          fix: "Wrap your config export with defineConfig() from @williamthorsen/nmr/config for type safety"
        },
        // `error` because falling short produces wrong results rather than a failure. Names and fixes are
        // getters because their version constants are declared below the kit.
        {
          get name() {
            return `eslint >= ${MIN_ESLINT_VERSION}`;
          },
          severity: "error",
          skip: () => !hasDevDependency("eslint") ? "eslint not installed" : false,
          check: hasSupportedEslintVersion,
          get fix() {
            return `pnpm add --save-dev eslint@^${MIN_ESLINT_VERSION} \u2014 earlier releases resolve config from the working directory, so nmr's root lint and lint:check would apply the root config to every package`;
          }
        },
        {
          get name() {
            return `@williamthorsen/strict-lint >= ${MIN_STRICT_LINT_VERSION}`;
          },
          severity: "error",
          skip: () => !hasDevDependency("@williamthorsen/strict-lint") ? "strict-lint not installed" : false,
          check: hasSupportedStrictLintVersion,
          get fix() {
            return `pnpm add --save-dev @williamthorsen/strict-lint@^${MIN_STRICT_LINT_VERSION} \u2014 earlier releases pin ESLint to one config and resolve ceilings from the working directory, so nmr's root lint:strict would report the wrong rules for every package`;
          }
        },
        // -- Root script cleanup -------------------------------------------------
        {
          name: "root package.json has no nmr-provided scripts",
          severity: "warn",
          quiet: true,
          check: noRedundantRootScripts,
          fix: "Remove scripts from root package.json that nmr provides as built-in root scripts \u2014 invoke via nmr directly"
        },
        // -- Workspace build readiness -------------------------------------------
        {
          name: "all workspace packages can build",
          severity: "warn",
          check: allWorkspacePackagesCanBuild,
          fix: `Add "build": ":" to packages that don't need a build, or ensure packages that use the default nmr build have a tsconfig.json and a src/ directory`
        },
        // -- Vitest projects -----------------------------------------------------
        {
          name: "no retired Vitest config variants",
          severity: "error",
          quiet: true,
          check: () => noRetiredVitestConfigs(),
          fix: "Delete every vitest.standalone.config.* and vitest.integration.config.*. nmr's test scripts select Vitest projects instead of naming config files"
        },
        {
          name: "vitest.config.ts builds on @williamthorsen/nmr/vitest",
          severity: "error",
          check: () => vitestConfigBuildsOnSharedConfig(),
          fix: "Replace vitest.config.ts with: import { defineVitestConfig } from '@williamthorsen/nmr/vitest'; export default defineVitestConfig();"
        },
        {
          name: "vitest.root.config.ts builds on @williamthorsen/nmr/vitest",
          severity: "error",
          check: () => vitestRootConfigBuildsOnSharedConfig(),
          fix: "Replace vitest.root.config.ts with: import { defineRootVitestConfig } from '@williamthorsen/nmr/vitest'; export default defineRootVitestConfig({ monorepoRoot: import.meta.dirname });"
        },
        {
          name: "every test file names its isolation tier",
          severity: "error",
          check: () => everyTestFileNamesItsTier(),
          fix: `Rename each to <subject>[.<aspect>].<tier>.test.ts, naming one of ${TIER_NAMES.join(", ")}. Use tool for a test that reaches a program the environment supplies, which is where a retired .int. or .integration. file belongs. Only the segment before .test. selects a project, so an untiered file runs under the residual unit project and reports success`
        },
        {
          name: "no package re-exports the ancestor Vitest config",
          severity: "recommend",
          quiet: true,
          check: () => noReExportOnlyVitestConfigs(),
          fix: "Delete these files. Vitest resolves config by walking up from the run root, so a per-package re-export is redundant"
        },
        // -- Shared Prettier config ----------------------------------------------
        {
          name: "Prettier config builds on @williamthorsen/nmr/prettier",
          severity: "error",
          check: () => prettierConfigBuildsOnSharedConfig(),
          fix: "Replace the Prettier config with: import { definePrettierConfig } from '@williamthorsen/nmr/prettier'; export default definePrettierConfig();"
        },
        // -- Audit dependency --------------------------------------------------------
        {
          name: "v11y-check in devDependencies",
          severity: "warn",
          check: () => hasDevDependency("v11y-check"),
          fix: "pnpm add --save-dev v11y-check"
        },
        // -- Legacy script runner ------------------------------------------------
        {
          name: "scripts/run-workspace-script.ts does not exist",
          severity: "error",
          quiet: true,
          check: () => !fileExists("scripts/run-workspace-script.ts"),
          fix: "Delete scripts/run-workspace-script.ts \u2014 nmr replaces this custom script runner"
        },
        {
          name: 'no workspace packages reference run-workspace-script or "pnpm run ws"',
          severity: "error",
          quiet: true,
          check: noWorkspaceRunScriptReferences,
          fix: 'Remove "ws" script entries and replace any "pnpm run ws" invocations with nmr in each packages/*/package.json'
        }
      ]
    }
  ]
});
var SCAN_EXCLUDE_DIRS = /* @__PURE__ */ new Set([".git", "coverage", "dist", "node_modules"]);
var CONFIG_EXTENSIONS = "{ts,mts,cts,js,mjs,cjs}";
var SHARED_VITEST_MODULE = "@williamthorsen/nmr/vitest";
var SHARED_PRETTIER_MODULE = "@williamthorsen/nmr/prettier";
var INERT_PRETTIER_CONFIGS = [".prettierrc", ".prettierrc.{json,json5,yaml,yml,toml}"];
var RE_EXPORT_LINE_PATTERN = /^export\s*(?:\{\s*default\s*}|\*)\s*from\s*['"]\.\.\/[^'"]*['"];?$/;
var MIN_ESLINT_VERSION = "10.0.0";
var MIN_STRICT_LINT_VERSION = "9.3.0";
var WORKSPACE_VERSION_MARKERS = ["catalog:", "workspace:"];
function allWorkspacePackagesCanBuild() {
  const packagesDir = join(process.cwd(), "packages");
  if (!existsSync(packagesDir)) return true;
  const entries = readdirSync2(packagesDir, { withFileTypes: true });
  const failing = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgPath = `packages/${entry.name}/package.json`;
    const content = readFile(pkgPath);
    if (!content) continue;
    const hasBuildOverride = /"build"\s*:/.test(content);
    const hasDefaultBuildInputs = fileExists(`packages/${entry.name}/tsconfig.json`) && existsSync(join(packagesDir, entry.name, "src"));
    if (!hasBuildOverride && !hasDefaultBuildInputs) {
      failing.push(entry.name);
    }
  }
  if (failing.length === 0) return true;
  return {
    ok: false,
    detail: `missing build override or tsconfig.json + src/: ${failing.join(", ")}`
  };
}
function checkNoMatchingFiles(patterns, cwd) {
  const found = findFiles(patterns, cwd);
  if (found.length === 0) return true;
  return { ok: false, detail: formatPaths(found) };
}
function checkRootVitestConfig(baseName, exportName, cwd) {
  const matches = findFiles([`${baseName}.${CONFIG_EXTENSIONS}`], cwd);
  if (matches.length === 0) {
    return { ok: false, detail: `${baseName}.ts is missing` };
  }
  const stale = matches.filter(
    (relativePath) => !importsSharedExport(readFileIn(cwd, relativePath), exportName, SHARED_VITEST_MODULE)
  );
  if (stale.length === 0) return true;
  return { ok: false, detail: `does not import ${exportName} from ${SHARED_VITEST_MODULE}: ${stale.join(", ")}` };
}
function prettierConfigBuildsOnSharedConfig(cwd = process.cwd()) {
  const configs = findFiles(
    [`.prettierrc.${CONFIG_EXTENSIONS}`, `prettier.config.${CONFIG_EXTENSIONS}`],
    //
    cwd
  );
  if (configs.length === 0) {
    return { ok: false, detail: describeMissingPrettierConfig(cwd) };
  }
  const stale = configs.filter(
    (relativePath) => !importsSharedExport(readFileIn(cwd, relativePath), "definePrettierConfig", SHARED_PRETTIER_MODULE)
  );
  if (stale.length === 0) return true;
  return {
    ok: false,
    detail: `does not import definePrettierConfig from ${SHARED_PRETTIER_MODULE}: ${stale.join(", ")}`
  };
}
function describeMissingPrettierConfig(cwd) {
  const inert = findFiles(INERT_PRETTIER_CONFIGS, cwd);
  if (inert.length > 0) return `holds no code to call the factory: ${inert.join(", ")}`;
  if (hasPrettierConfigKey(cwd)) {
    return 'holds no code to call the factory: the "prettier" key in package.json';
  }
  return ".prettierrc.js is missing";
}
function hasPrettierConfigKey(cwd) {
  const manifest = readFileIn(cwd, "package.json");
  if (manifest === void 0) return false;
  try {
    const parsed = JSON.parse(manifest);
    return isRecord(parsed) && parsed["prettier"] !== void 0;
  } catch {
    return false;
  }
}
function everyTestFileNamesItsTier(cwd = process.cwd()) {
  const untiered = findTestFiles(cwd).filter((path2) => !hasTierInfix(path2));
  if (untiered.length === 0) return true;
  return { ok: false, detail: formatPaths(untiered) };
}
function findFiles(patterns, cwd) {
  return globSync(patterns, { cwd, exclude: (path2) => SCAN_EXCLUDE_DIRS.has(basename(path2)) }).map((path2) => path2.split(sep).join("/")).toSorted();
}
function formatPaths(paths) {
  return `${paths.length} found:
${paths.map((path2) => `      ${path2}`).join("\n")}`;
}
function getMinVersion() {
  const picked = { "version": "0.32.1" };
  if (typeof picked["version"] !== "string") {
    throw new TypeError("nmr/package.json: 'version' must be a string");
  }
  return picked["version"];
}
function hasSupportedEslintVersion() {
  return hasMinDevDependencyVersion("eslint", MIN_ESLINT_VERSION, {
    exempt: resolvesVersionViaWorkspace
  });
}
function hasSupportedStrictLintVersion() {
  return hasMinDevDependencyVersion("@williamthorsen/strict-lint", MIN_STRICT_LINT_VERSION, {
    exempt: resolvesVersionViaWorkspace
  });
}
function importsSharedExport(content, exportName, moduleSpecifier) {
  if (content === void 0) return false;
  const pattern = new RegExp(String.raw`import\s*\{[^}]*\b${exportName}\b[^}]*\}\s*from\s*['"]${moduleSpecifier}['"]`);
  return pattern.test(content);
}
function isReExportOnly(content) {
  if (content === void 0) return false;
  const statements = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  return statements.length > 0 && statements.every((line) => RE_EXPORT_LINE_PATTERN.test(line));
}
function noPnpmFieldInPackageJson(cwd = process.cwd()) {
  const declaring = findFiles(["**/package.json"], cwd).flatMap((relativePath) => {
    const keys = readPnpmFieldKeys(readFileIn(cwd, relativePath));
    if (keys === void 0) return [];
    return [keys.length > 0 ? `${relativePath} (${keys.join(", ")})` : relativePath];
  });
  if (declaring.length === 0) return true;
  return { ok: false, detail: formatPaths(declaring) };
}
function noReExportOnlyVitestConfigs(cwd = process.cwd()) {
  const nonRootConfigs = findFiles([`**/vitest.config.${CONFIG_EXTENSIONS}`], cwd).filter((path2) => path2.includes("/"));
  const reExports = nonRootConfigs.filter((path2) => isReExportOnly(readFileIn(cwd, path2)));
  if (reExports.length === 0) return true;
  return { ok: false, detail: formatPaths(reExports) };
}
function noRedundantRootScripts() {
  const pkg = readPackageJson();
  if (!pkg) return true;
  const scripts = pkg["scripts"];
  if (!isRecord(scripts)) return true;
  const builtInNames = Object.keys(getDefaultRootScripts());
  const redundant = Object.keys(scripts).filter((name) => builtInNames.includes(name));
  if (redundant.length === 0) return true;
  return {
    ok: false,
    detail: `redundant: ${redundant.join(", ")}`
  };
}
function noRetiredVitestConfigs(cwd = process.cwd()) {
  return checkNoMatchingFiles(
    [`**/vitest.standalone.config.${CONFIG_EXTENSIONS}`, `**/vitest.integration.config.${CONFIG_EXTENSIONS}`],
    cwd
  );
}
function noWorkspaceRunScriptReferences() {
  const packagesDir = join(process.cwd(), "packages");
  if (!existsSync(packagesDir)) return true;
  const legacyPattern = /run-workspace-script|"pnpm\s+run\s+ws\b/;
  const entries = readdirSync2(packagesDir, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const content = readFile(`packages/${entry.name}/package.json`);
    if (content && legacyPattern.test(content)) {
      matches.push(entry.name);
    }
  }
  if (matches.length === 0) return true;
  return {
    ok: false,
    detail: `found in: ${matches.join(", ")}`
  };
}
function readFileIn(cwd, relativePath) {
  try {
    return readFileSync(join(cwd, relativePath), "utf8");
  } catch {
    return void 0;
  }
}
function readPnpmFieldKeys(content) {
  if (content === void 0) return void 0;
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return void 0;
  }
  if (!isRecord(parsed)) return void 0;
  const pnpm = parsed["pnpm"];
  return isRecord(pnpm) ? Object.keys(pnpm).toSorted() : void 0;
}
function resolvesVersionViaWorkspace(range) {
  return WORKSPACE_VERSION_MARKERS.some((marker) => range.startsWith(marker));
}
function toolVersionsHasNoPnpm() {
  const content = readFile(".tool-versions");
  if (content === void 0) return true;
  return !/^pnpm\s/m.test(content);
}
function vitestConfigBuildsOnSharedConfig(cwd = process.cwd()) {
  return checkRootVitestConfig("vitest.config", "defineVitestConfig", cwd);
}
function vitestRootConfigBuildsOnSharedConfig(cwd = process.cwd()) {
  return checkRootVitestConfig("vitest.root.config", "defineRootVitestConfig", cwd);
}
export {
  default_default as default,
  everyTestFileNamesItsTier,
  hasSupportedEslintVersion,
  hasSupportedStrictLintVersion,
  noPnpmFieldInPackageJson,
  noReExportOnlyVitestConfigs,
  noRetiredVitestConfigs,
  prettierConfigBuildsOnSharedConfig,
  vitestConfigBuildsOnSharedConfig,
  vitestRootConfigBuildsOnSharedConfig
};
