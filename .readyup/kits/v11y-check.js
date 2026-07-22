/** @noformat — @generated. Do not edit. Compiled by rdy. */
/* eslint-disable */
export const __readyupVersion = "0.21.2";


// .readyup/kits/v11y-check.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineRdyKit } from "readyup";
import { fileExists, fileMatchesHash, hasDevDependency, hasMinDevDependencyVersion } from "readyup/check-utils";
var AUDIT_WORKFLOW_HASH = "cdcab39d794ed7ec5ea45e8f3c887eb5d15edb63eab65e515714556933d9b03f";
var v11y_check_default = defineRdyKit({
  checklists: [
    {
      name: "v11y-check",
      checks: [
        // -- Setup ---------------------------------------------------------------
        {
          name: "v11y-check in devDependencies",
          severity: "error",
          check: () => hasDevDependency("v11y-check"),
          fix: "pnpm add --save-dev v11y-check",
          checks: [
            {
              get name() {
                return `v11y-check >= ${getMinVersion()}`;
              },
              severity: "error",
              check: () => hasMinDevDependencyVersion("v11y-check", getMinVersion(), {
                exempt: (range) => range.startsWith("workspace:")
              }),
              get fix() {
                return `pnpm add --save-dev v11y-check@^${getMinVersion()}`;
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
function getMinVersion() {
  const picked = { "version": "0.11.1" };
  if (typeof picked.version !== "string") {
    throw new TypeError("v11y-check/package.json: 'version' must be a string");
  }
  return picked.version;
}
function noLegacyAuditCiDirectory() {
  return !existsSync(join(process.cwd(), ".audit-ci"));
}
function skipLegacyAuditCiCheck() {
  return !existsSync(join(process.cwd(), ".audit-ci")) ? "no legacy .audit-ci/ directory" : false;
}
export {
  AUDIT_WORKFLOW_HASH,
  v11y_check_default as default,
  noLegacyAuditCiDirectory,
  skipLegacyAuditCiCheck
};
