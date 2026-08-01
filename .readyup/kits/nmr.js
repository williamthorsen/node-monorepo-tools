/** @noformat — @generated. Do not edit. Compiled by rdy. */
/* eslint-disable */
export const __readyupVersion = "0.23.0";


// .readyup/kits/nmr.ts
import { existsSync, globSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, sep } from "node:path";

// packages/nmr/dist/esm/default-scripts.js
var GATE_PROJECTS = "--project unit --project tool";
var workspaceScripts = {
  build: ["compile"],
  check: ["typecheck", "fmt:check", "lint:check", "test"],
  "check:strict": ["typecheck", "fmt:check", "lint:strict", "test:coverage"],
  clean: "nmr-clean",
  compile: "nmr-compile",
  fix: ["lint", "fmt"],
  "fix:check": ["fmt:check", "lint:check"],
  fmt: "nmr-fmt --write",
  "fmt:check": "nmr-fmt --check",
  lint: "eslint --fix .",
  "lint:check": "eslint .",
  "lint:strict": "strict-lint",
  test: `pnpm exec vitest ${GATE_PROJECTS}`,
  "test:all": "pnpm exec vitest",
  "test:coverage": `pnpm exec vitest ${GATE_PROJECTS} --coverage`,
  "test:tool": "pnpm exec vitest --project tool",
  "test:unit": "pnpm exec vitest --project unit",
  "test:watch": `pnpm exec vitest ${GATE_PROJECTS} --watch`,
  typecheck: "tsgo --noEmit",
  upgrade: "nmr-taze --include-locked",
  "view-coverage": "open coverage/index.html"
};
var rootScripts = {
  audit: ["audit:prod", "audit:dev"],
  "audit:dev": "pnpm exec v11y --dev",
  "audit:prod": "pnpm exec v11y --prod",
  build: "pnpm --recursive exec nmr build",
  check: ["typecheck", "fmt:check", "lint:check", "test"],
  "check:agent-files": "nmr-sync-agent-files --check",
  "check:strict": ["typecheck", "fmt:check", "lint:strict", "test:coverage", "check:agent-files"],
  ci: ["build", "check:strict", "audit"],
  clean: "nmr-clean",
  fix: ["lint", "fmt"],
  "fix:check": ["fmt:check", "lint:check"],
  fmt: "nmr-fmt --write",
  "fmt:check": "nmr-fmt --check",
  lint: "nmr root:lint && pnpm --recursive exec nmr lint",
  "lint:check": "nmr root:lint:check && pnpm --recursive exec nmr lint:check",
  "lint:strict": "nmr root:lint:strict && pnpm --recursive exec nmr lint:strict",
  "report-overrides": "nmr-report-overrides",
  "root:check": ["root:typecheck", "fmt:check", "root:lint:check", "root:test"],
  "root:lint": "eslint --fix --ignore-pattern 'packages/**' .",
  "root:lint:check": "eslint --ignore-pattern 'packages/**' .",
  "root:lint:strict": "strict-lint --ignore-pattern 'packages/**' .",
  "root:test": `vitest --config ./vitest.root.config.ts ${GATE_PROJECTS}`,
  "root:test:all": "vitest --config ./vitest.root.config.ts",
  "root:test:tool": "vitest --config ./vitest.root.config.ts --project tool",
  "root:test:unit": "vitest --config ./vitest.root.config.ts --project unit",
  "root:typecheck": "tsgo --noEmit",
  "root:upgrade": "nmr-taze --include-locked",
  "sync-agent-files": "nmr-sync-agent-files",
  test: "nmr root:test && pnpm --recursive exec nmr test",
  "test:all": "nmr root:test:all && pnpm --recursive exec nmr test:all",
  "test:coverage": "nmr root:test && pnpm --recursive exec nmr test:coverage",
  "test:tool": "nmr root:test:tool && pnpm --recursive exec nmr test:tool",
  "test:unit": "nmr root:test:unit && pnpm --recursive exec nmr test:unit",
  "test:watch": `vitest ${GATE_PROJECTS} --watch`,
  typecheck: "nmr root:typecheck && pnpm --recursive exec nmr typecheck",
  upgrade: "nmr-report-overrides && nmr-taze --include-locked --recursive"
};

// packages/nmr/dist/esm/resolve-scripts.js
function getDefaultRootScripts() {
  return { ...rootScripts };
}

// .readyup/kits/nmr.ts
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
var nmr_default = defineRdyKit({
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
                exempt: (range) => range.startsWith("workspace:")
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
          check: toolVersionsHasNoPnpm,
          fix: "Remove pnpm from .tool-versions \u2014 manage via packageManager field and corepack"
        },
        {
          name: ".config/nmr.config.ts uses defineConfig",
          severity: "recommend",
          skip: () => !fileExists(".config/nmr.config.ts") ? "no nmr config file" : false,
          check: () => fileContains(".config/nmr.config.ts", /defineConfig/),
          fix: "Wrap your config export with defineConfig() from @williamthorsen/nmr for type safety"
        },
        // -- Root script cleanup -------------------------------------------------
        {
          name: "root package.json has no nmr-provided scripts",
          severity: "warn",
          check: noRedundantRootScripts,
          fix: "Remove scripts from root package.json that nmr provides as built-in root scripts \u2014 invoke via nmr directly"
        },
        {
          name: "root:lint:strict does not use echo fallback",
          severity: "warn",
          skip: () => !scriptExists("root:lint:strict") ? "no root:lint:strict script" : false,
          check: () => !scriptMatches("root:lint:strict", /\becho\b/),
          fix: "Replace the echo fallback in root:lint:strict \u2014 strict-lint now supports path arguments"
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
          name: "no test files use the .integration. suffix",
          severity: "error",
          check: () => noIntegrationSuffixedTests(),
          fix: "Rename *.integration.test.ts to *.int.test.ts. The integration project matches .int. only, so these run as unit tests while nmr test:integration collects nothing"
        },
        {
          name: "no test files use the .drift. suffix",
          severity: "recommend",
          check: () => noDriftSuffixedTests(),
          fix: "Rename *.drift.test.ts to *.app.test.ts, the canonical suffix for the app project"
        },
        {
          name: "no package re-exports the ancestor Vitest config",
          severity: "recommend",
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
        {
          name: "code-quality workflow does not use nmr ci",
          severity: "warn",
          skip: () => !fileExists(".github/workflows/code-quality.yaml") ? "no code-quality workflow" : false,
          check: codeQualityWorkflowDoesNotUseNmrCi,
          fix: 'Change the check-command in .github/workflows/code-quality.yaml from "pnpm exec nmr ci" to "pnpm exec nmr build && pnpm exec nmr check:strict"'
        },
        // -- Legacy script runner ------------------------------------------------
        {
          name: "scripts/run-workspace-script.ts does not exist",
          severity: "error",
          check: () => !fileExists("scripts/run-workspace-script.ts"),
          fix: "Delete scripts/run-workspace-script.ts \u2014 nmr replaces this custom script runner"
        },
        {
          name: 'no workspace packages reference run-workspace-script or "pnpm run ws"',
          severity: "error",
          check: noWorkspaceRunScriptReferences,
          fix: 'Remove "ws" script entries and replace any "pnpm run ws" invocations with nmr in each packages/*/package.json'
        }
      ]
    }
  ]
});
var SCAN_EXCLUDE_DIRS = /* @__PURE__ */ new Set([".git", "coverage", "dist", "node_modules"]);
var CONFIG_EXTENSIONS = "{ts,mts,cts,js,mjs,cjs}";
var TEST_EXTENSIONS = "{ts,tsx}";
var TEST_GLOB_PREFIX = "**/__tests__/**";
var SHARED_VITEST_MODULE = "@williamthorsen/nmr/vitest";
var SHARED_PRETTIER_MODULE = "@williamthorsen/nmr/prettier";
var INERT_PRETTIER_CONFIGS = [".prettierrc", ".prettierrc.{json,json5,yaml,yml,toml}"];
var RE_EXPORT_LINE_PATTERN = /^export\s*(?:\{\s*default\s*\}|\*)\s*from\s*['"]\.\.\/[^'"]*['"];?$/;
function allWorkspacePackagesCanBuild() {
  const packagesDir = join(process.cwd(), "packages");
  if (!existsSync(packagesDir)) return true;
  const entries = readdirSync(packagesDir, { withFileTypes: true });
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
    return isRecord(parsed) && parsed.prettier !== void 0;
  } catch {
    return false;
  }
}
function codeQualityWorkflowDoesNotUseNmrCi() {
  const content = readFile(".github/workflows/code-quality.yaml");
  if (content === void 0) return true;
  return !/check-command:\s*pnpm exec nmr ci(\s|$)/.test(content);
}
function findFiles(patterns, cwd) {
  return globSync(patterns, { cwd, exclude: (path) => SCAN_EXCLUDE_DIRS.has(basename(path)) }).map((path) => path.split(sep).join("/")).toSorted();
}
function formatPaths(paths) {
  return `${paths.length} found:
${paths.map((path) => `      ${path}`).join("\n")}`;
}
function getMinVersion() {
  const picked = { "version": "0.23.0" };
  if (typeof picked.version !== "string") {
    throw new TypeError("nmr/package.json: 'version' must be a string");
  }
  return picked.version;
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
function noDriftSuffixedTests(cwd = process.cwd()) {
  return checkNoMatchingFiles([`${TEST_GLOB_PREFIX}/*.drift.test.${TEST_EXTENSIONS}`], cwd);
}
function noIntegrationSuffixedTests(cwd = process.cwd()) {
  return checkNoMatchingFiles([`${TEST_GLOB_PREFIX}/*.integration.test.${TEST_EXTENSIONS}`], cwd);
}
function noReExportOnlyVitestConfigs(cwd = process.cwd()) {
  const nonRootConfigs = findFiles([`**/vitest.config.${CONFIG_EXTENSIONS}`], cwd).filter((path) => path.includes("/"));
  const reExports = nonRootConfigs.filter((path) => isReExportOnly(readFileIn(cwd, path)));
  if (reExports.length === 0) return true;
  return { ok: false, detail: formatPaths(reExports) };
}
function noRedundantRootScripts() {
  const pkg = readPackageJson();
  if (!pkg) return true;
  const scripts = pkg.scripts;
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
  const entries = readdirSync(packagesDir, { withFileTypes: true });
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
function scriptExists(name) {
  const pkg = readPackageJson();
  if (!pkg) return false;
  const scripts = pkg.scripts;
  return isRecord(scripts) && name in scripts;
}
function scriptMatches(name, pattern) {
  const pkg = readPackageJson();
  if (!pkg) return false;
  const scripts = pkg.scripts;
  if (!isRecord(scripts)) return false;
  const value = scripts[name];
  return typeof value === "string" && pattern.test(value);
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
  codeQualityWorkflowDoesNotUseNmrCi,
  nmr_default as default,
  noDriftSuffixedTests,
  noIntegrationSuffixedTests,
  noReExportOnlyVitestConfigs,
  noRetiredVitestConfigs,
  prettierConfigBuildsOnSharedConfig,
  vitestConfigBuildsOnSharedConfig,
  vitestRootConfigBuildsOnSharedConfig
};
