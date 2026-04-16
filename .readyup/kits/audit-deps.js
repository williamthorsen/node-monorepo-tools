/** @noformat — @generated. Do not edit. Compiled by rdy. */
/* eslint-disable */


// .readyup/kits/audit-deps.ts
import { existsSync as existsSync2 } from "node:fs";
import { join as join2 } from "node:path";

// node_modules/.pnpm/readyup@0.16.0_esbuild@0.28.0/node_modules/readyup/dist/esm/authoring.js
function defineRdyKit(kit) {
  return kit;
}

// node_modules/.pnpm/readyup@0.16.0_esbuild@0.28.0/node_modules/readyup/dist/esm/isRecord.js
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// node_modules/.pnpm/readyup@0.16.0_esbuild@0.28.0/node_modules/readyup/dist/esm/check-utils/filesystem.js
import { execSync } from "node:child_process";
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

// node_modules/.pnpm/readyup@0.16.0_esbuild@0.28.0/node_modules/readyup/dist/esm/check-utils/hashing.js
import { createHash } from "node:crypto";
function computeHash(content) {
  return createHash("sha256").update(content).digest("hex");
}
function fileMatchesHash(relativePath, expectedHash) {
  const content = readFile(relativePath);
  if (content === void 0) return false;
  return computeHash(content) === expectedHash;
}

// node_modules/.pnpm/readyup@0.16.0_esbuild@0.28.0/node_modules/readyup/dist/esm/safeJsonParse.js
function safeJsonParse(content) {
  try {
    const parsed = JSON.parse(content);
    return parsed;
  } catch {
    return void 0;
  }
}

// node_modules/.pnpm/readyup@0.16.0_esbuild@0.28.0/node_modules/readyup/dist/esm/check-utils/json.js
function readJsonFile(relativePath) {
  const content = readFile(relativePath);
  if (content === void 0) return void 0;
  const parsed = safeJsonParse(content);
  if (!isRecord(parsed)) return void 0;
  return parsed;
}

// node_modules/.pnpm/readyup@0.16.0_esbuild@0.28.0/node_modules/readyup/dist/esm/check-utils/semver.js
function compareVersions(a, b) {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// node_modules/.pnpm/readyup@0.16.0_esbuild@0.28.0/node_modules/readyup/dist/esm/check-utils/package-json.js
function hasDevDependency(name) {
  const pkg = readJsonFile("package.json");
  if (pkg === void 0) return false;
  const devDeps = pkg.devDependencies;
  return isRecord(devDeps) && name in devDeps;
}
function hasMinDevDependencyVersion(name, minVersion, options) {
  const pkg = readJsonFile("package.json");
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

// packages/audit-deps/package.json
var package_default = {
  name: "@williamthorsen/audit-deps",
  version: "0.2.1",
  private: false,
  description: "Wrap audit-ci with a richer config model, typed JSON source of truth, and sync workflow",
  keywords: [
    "audit",
    "audit-ci",
    "dependencies",
    "security",
    "vulnerabilities"
  ],
  homepage: "https://github.com/williamthorsen/node-monorepo-tools/tree/main/packages/audit-deps#readme",
  bugs: {
    url: "https://github.com/williamthorsen/node-monorepo-tools/issues"
  },
  repository: {
    type: "git",
    url: "https://github.com/williamthorsen/node-monorepo-tools.git",
    directory: "packages/audit-deps"
  },
  license: "ISC",
  author: "William Thorsen <william@thorsen.dev> (https://github.com/williamthorsen)",
  type: "module",
  exports: {
    ".": {
      import: "./dist/esm/index.js",
      types: "./dist/esm/index.d.ts"
    }
  },
  bin: {
    "audit-deps": "bin/audit-deps.js"
  },
  files: [
    "bin",
    "dist"
  ],
  scripts: {
    prepare: "tsx ../../config/generateVersion.ts && tsx ../../config/build.ts && tsc --project tsconfig.generate-typings.json"
  },
  dependencies: {
    "@williamthorsen/node-monorepo-core": "workspace:*",
    "audit-ci": "7.1.0",
    zod: "4.3.6"
  },
  engines: {
    node: ">=18.17.0"
  },
  publishConfig: {
    access: "public"
  }
};

// .readyup/kits/audit-deps.ts
var MIN_VERSION = package_default.version;
var AUDIT_WORKFLOW_HASH = "1b656bf31d7d4d5275a6db16ad1efcc71ff1cb08bf7025dc26fbeccf4485c884";
var audit_deps_default = defineRdyKit({
  checklists: [
    {
      name: "audit-deps",
      checks: [
        // -- Setup ---------------------------------------------------------------
        {
          name: "@williamthorsen/audit-deps in devDependencies",
          severity: "error",
          check: () => hasDevDependency("@williamthorsen/audit-deps"),
          fix: "pnpm add --save-dev @williamthorsen/audit-deps",
          checks: [
            {
              name: `@williamthorsen/audit-deps >= ${MIN_VERSION}`,
              severity: "error",
              check: () => hasMinDevDependencyVersion("@williamthorsen/audit-deps", MIN_VERSION, {
                exempt: (range) => range.startsWith("workspace:")
              }),
              fix: `pnpm add --save-dev @williamthorsen/audit-deps@^${MIN_VERSION}`
            }
          ]
        },
        // -- Config existence ----------------------------------------------------
        {
          name: ".config/audit-deps.config.json exists",
          severity: "warn",
          check: auditDepsConfigExists,
          fix: "Create .config/audit-deps.config.json with audit-deps configuration"
        },
        // -- Audit-ci config migration -------------------------------------------
        {
          name: "audit-ci configs are under .config/audit-ci/",
          severity: "warn",
          skip: skipLegacyAuditCiCheck,
          check: noLegacyAuditCiDirectory,
          fix: "Move audit-ci configs from .audit-ci/ to .config/audit-ci/ and update references"
        },
        // -- Audit workflow ------------------------------------------------------
        {
          name: "audit.yaml workflow exists",
          severity: "warn",
          check: () => fileExists(".github/workflows/audit.yaml"),
          fix: "Add .github/workflows/audit.yaml using the audit workflow template",
          checks: [
            {
              name: "audit.yaml matches template",
              severity: "warn",
              check: () => fileMatchesHash(".github/workflows/audit.yaml", AUDIT_WORKFLOW_HASH),
              fix: "Replace .github/workflows/audit.yaml with the current template at williamthorsen/node-monorepo-tools:.github/workflows/audit.yaml"
            }
          ]
        }
      ]
    }
  ]
});
function auditDepsConfigExists() {
  return fileExists(".config/audit-deps.config.json");
}
function skipLegacyAuditCiCheck() {
  return !existsSync2(join2(process.cwd(), ".audit-ci")) ? "no legacy .audit-ci/ directory" : false;
}
function noLegacyAuditCiDirectory() {
  return !existsSync2(join2(process.cwd(), ".audit-ci"));
}
export {
  AUDIT_WORKFLOW_HASH,
  auditDepsConfigExists,
  audit_deps_default as default,
  noLegacyAuditCiDirectory,
  skipLegacyAuditCiCheck
};
