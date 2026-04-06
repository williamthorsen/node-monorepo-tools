/** @noformat — @generated. Do not edit. Compiled by preflight. */
/* eslint-disable */


// packages/preflight/dist/esm/authoring.js
function definePreflightCollection(collection) {
  return collection;
}

// packages/preflight/dist/esm/check-utils/filesystem.js
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
function fileExists(relativePath) {
  return existsSync(join(process.cwd(), relativePath));
}
function readFile(relativePath) {
  const fullPath = join(process.cwd(), relativePath);
  if (!existsSync(fullPath)) return void 0;
  return readFileSync(fullPath, "utf8");
}
function fileContains(relativePath, pattern) {
  const content = readFile(relativePath);
  if (content === void 0) return false;
  return pattern.test(content);
}

// packages/preflight/dist/esm/isRecord.js
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// packages/preflight/dist/esm/check-utils/semver.js
function compareVersions(a, b) {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// packages/preflight/dist/esm/check-utils/package-json.js
function readPackageJson() {
  const content = readFile("package.json");
  if (content === void 0) return void 0;
  const parsed = JSON.parse(content);
  if (!isRecord(parsed)) return void 0;
  return Object.fromEntries(Object.entries(parsed));
}
function hasPackageJsonField(field, expectedValue) {
  const pkg = readPackageJson();
  if (pkg === void 0) return false;
  if (expectedValue !== void 0) return pkg[field] === expectedValue;
  return field in pkg;
}
function hasDevDependency(name) {
  const pkg = readPackageJson();
  if (pkg === void 0) return false;
  const devDeps = pkg.devDependencies;
  return isRecord(devDeps) && name in devDeps;
}
function hasMinDevDependencyVersion(name, minVersion, options) {
  const pkg = readPackageJson();
  if (pkg === void 0) return false;
  const devDeps = pkg.devDependencies;
  if (!isRecord(devDeps) || !(name in devDeps)) return false;
  const range = devDeps[name];
  if (typeof range !== "string") return false;
  if (options?.exempt?.(range)) return true;
  const versionMatch = /(\d+\.\d+\.\d+)/.exec(range)?.[1];
  if (versionMatch === void 0) return false;
  return compareVersions(versionMatch, minVersion) >= 0;
}

// packages/nmr/package.json
var package_default = {
  name: "@williamthorsen/nmr",
  version: "0.9.0",
  private: false,
  description: "Context-aware script runner for PNPM monorepos",
  keywords: [
    "monorepo",
    "pnpm",
    "script-runner",
    "workspace"
  ],
  license: "MIT",
  author: "William Thorsen <william@thorsen.dev> (https://github.com/williamthorsen)",
  type: "module",
  exports: {
    ".": "./dist/esm/index.js",
    "./tests": "./dist/esm/tests/consistency.js"
  },
  bin: {
    "ensure-prepublish-hooks": "bin/ensure-prepublish-hooks.js",
    nmr: "bin/nmr.js",
    "nmr-report-overrides": "bin/nmr-report-overrides.js",
    "nmr-sync-pnpm-version": "bin/nmr-sync-pnpm-version.js"
  },
  files: [
    "bin",
    "dist"
  ],
  scripts: {
    prepare: "tsx ../../config/generateVersion.ts && tsx ../../config/build.ts && tsc --project tsconfig.generate-typings.json"
  },
  dependencies: {
    jiti: "2.6.1",
    "js-yaml": "4.1.1",
    zod: "4.3.6"
  },
  publishConfig: {
    access: "public"
  }
};

// .preflight/collections/nmr.ts
var MIN_VERSION = package_default.version;
var nmr_default = definePreflightCollection({
  checklists: [
    {
      name: "nmr",
      checks: [
        {
          name: "@williamthorsen/nmr in devDependencies",
          severity: "error",
          check: () => hasDevDependency("@williamthorsen/nmr"),
          fix: "pnpm add --save-dev @williamthorsen/nmr"
        },
        {
          name: `@williamthorsen/nmr >= ${MIN_VERSION}`,
          severity: "error",
          check: () => hasMinDevDependencyVersion("@williamthorsen/nmr", MIN_VERSION, {
            exempt: (range) => range.startsWith("workspace:")
          }),
          fix: `pnpm add --save-dev @williamthorsen/nmr@^${MIN_VERSION}`
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
          check: () => toolVersionsHasNoPnpm(),
          fix: "Remove pnpm from .tool-versions \u2014 manage via packageManager field and corepack"
        },
        {
          name: ".config/nmr.config.ts uses defineConfig",
          severity: "recommend",
          skip: () => !fileExists(".config/nmr.config.ts") ? "no nmr config file" : false,
          check: () => fileContains(".config/nmr.config.ts", /defineConfig/),
          fix: "Wrap your config export with defineConfig() from @williamthorsen/nmr for type safety"
        }
      ]
    }
  ]
});
function toolVersionsHasNoPnpm() {
  const content = readFile(".tool-versions");
  if (content === void 0) return true;
  return !/^pnpm\s/m.test(content);
}
export {
  nmr_default as default
};
