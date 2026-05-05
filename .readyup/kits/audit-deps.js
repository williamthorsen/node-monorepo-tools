/** @noformat — @generated. Do not edit. Compiled by rdy. */
/* eslint-disable */


// .readyup/kits/audit-deps.ts
import { existsSync as existsSync2 } from "node:fs";
import { join as join2 } from "node:path";

// node_modules/.pnpm/readyup@0.20.0_esbuild@0.28.0/node_modules/readyup/dist/esm/authoring.js
function defineRdyKit(kit) {
  return kit;
}

// node_modules/.pnpm/readyup@0.20.0_esbuild@0.28.0/node_modules/readyup/dist/esm/isRecord.js
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// node_modules/.pnpm/readyup@0.20.0_esbuild@0.28.0/node_modules/readyup/dist/esm/check-utils/filesystem.js
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

// node_modules/.pnpm/readyup@0.20.0_esbuild@0.28.0/node_modules/readyup/dist/esm/check-utils/hashing.js
import { createHash } from "node:crypto";
function computeHash(content) {
  return createHash("sha256").update(content).digest("hex");
}
function fileMatchesHash(relativePath, expectedHash) {
  const content = readFile(relativePath);
  if (content === void 0) return false;
  return computeHash(content) === expectedHash;
}

// node_modules/.pnpm/readyup@0.20.0_esbuild@0.28.0/node_modules/readyup/dist/esm/safeJsonParse.js
function safeJsonParse(content) {
  try {
    const parsed = JSON.parse(content);
    return parsed;
  } catch {
    return void 0;
  }
}

// node_modules/.pnpm/readyup@0.20.0_esbuild@0.28.0/node_modules/readyup/dist/esm/check-utils/json.js
function readJsonFile(relativePath) {
  const content = readFile(relativePath);
  if (content === void 0) return void 0;
  const parsed = safeJsonParse(content);
  if (!isRecord(parsed)) return void 0;
  return parsed;
}

// node_modules/.pnpm/readyup@0.20.0_esbuild@0.28.0/node_modules/readyup/dist/esm/check-utils/semver.js
function compareVersions(a, b) {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// node_modules/.pnpm/readyup@0.20.0_esbuild@0.28.0/node_modules/readyup/dist/esm/check-utils/package-json.js
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

// .readyup/kits/audit-deps.ts
function getMinVersion() {
  const picked = { "version": "0.6.1" };
  if (typeof picked.version !== "string") {
    throw new TypeError("audit-deps/package.json: 'version' must be a string");
  }
  return picked.version;
}
var AUDIT_WORKFLOW_HASH = "cdcab39d794ed7ec5ea45e8f3c887eb5d15edb63eab65e515714556933d9b03f";
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
              get name() {
                return `@williamthorsen/audit-deps >= ${getMinVersion()}`;
              },
              severity: "error",
              check: () => hasMinDevDependencyVersion("@williamthorsen/audit-deps", getMinVersion(), {
                exempt: (range) => range.startsWith("workspace:")
              }),
              get fix() {
                return `pnpm add --save-dev @williamthorsen/audit-deps@^${getMinVersion()}`;
              }
            }
          ]
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
function skipLegacyAuditCiCheck() {
  return !existsSync2(join2(process.cwd(), ".audit-ci")) ? "no legacy .audit-ci/ directory" : false;
}
function noLegacyAuditCiDirectory() {
  return !existsSync2(join2(process.cwd(), ".audit-ci"));
}
export {
  AUDIT_WORKFLOW_HASH,
  audit_deps_default as default,
  noLegacyAuditCiDirectory,
  skipLegacyAuditCiCheck
};
