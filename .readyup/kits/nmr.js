/** @noformat — @generated. Do not edit. Compiled by rdy. */
/* eslint-disable */
export const __readyupVersion = "0.21.2";


// .readyup/kits/nmr.ts
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// packages/nmr/dist/esm/default-scripts.js
var rootScripts = {
  attw: "pnpm --recursive exec nmr attw",
  audit: ["audit:prod", "audit:dev"],
  "audit:dev": "pnpm exec v11y --dev",
  "audit:prod": "pnpm exec v11y --prod",
  build: "pnpm --recursive exec nmr build",
  check: ["typecheck", "fmt:check", "lint:check", "test"],
  "check:agent-files": "nmr-sync-agent-files --check",
  "check:strict": ["typecheck", "fmt:check", "lint:strict", "test:coverage", "attw", "check:agent-files"],
  ci: ["build", "check:strict", "audit"],
  clean: "pnpm --recursive exec nmr clean",
  fix: ["lint", "fmt"],
  "fix:check": ["fmt:check", "lint:check"],
  fmt: `sh -c 'prettier --list-different --write "\${@:-.}"' --`,
  "fmt:all": ["fmt", "fmt:sh"],
  "fmt:check": `sh -c 'prettier --check "\${@:-.}"' --`,
  "fmt:sh": "shfmt --write **/*.sh",
  lint: "nmr root:lint && pnpm --recursive exec nmr lint",
  "lint:check": "nmr root:lint:check && pnpm --recursive exec nmr lint:check",
  "lint:strict": "nmr root:lint:strict && pnpm --recursive exec nmr lint:strict",
  outdated: "pnpm outdated --compatible --recursive",
  "outdated:latest": "pnpm outdated --recursive",
  "report-overrides": "nmr-report-overrides",
  "root:check": ["root:typecheck", "fmt:check", "root:lint:check", "root:test"],
  "root:lint": "eslint --fix --ignore-pattern 'packages/**' .",
  "root:lint:check": "eslint --ignore-pattern 'packages/**' .",
  "root:lint:strict": "strict-lint --ignore-pattern 'packages/**' .",
  "root:test": "vitest --config ./vitest.root.config.ts",
  "root:typecheck": "tsgo --noEmit",
  "sync-agent-files": "nmr-sync-agent-files",
  "sync-pnpm-version": "nmr-sync-pnpm-version",
  test: "nmr root:test && pnpm --recursive exec nmr test",
  "test:coverage": "nmr root:test && pnpm --recursive exec nmr test:coverage",
  "test:watch": "vitest --watch",
  typecheck: "nmr root:typecheck && pnpm --recursive exec nmr typecheck",
  update: "pnpm update --recursive",
  "update:latest": "pnpm update --latest --recursive"
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
function codeQualityWorkflowDoesNotUseNmrCi() {
  const content = readFile(".github/workflows/code-quality.yaml");
  if (content === void 0) return true;
  return !/check-command:\s*pnpm exec nmr ci(\s|$)/.test(content);
}
function getMinVersion() {
  const picked = { "version": "0.16.0" };
  if (typeof picked.version !== "string") {
    throw new TypeError("nmr/package.json: 'version' must be a string");
  }
  return picked.version;
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
export {
  codeQualityWorkflowDoesNotUseNmrCi,
  nmr_default as default
};
