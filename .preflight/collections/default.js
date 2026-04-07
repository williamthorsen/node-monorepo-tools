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

// .preflight/collections/default.ts
var syncLabels = {
  name: "sync-labels",
  checks: [
    {
      name: "sync-labels.yaml workflow exists",
      check: () => fileExists(".github/workflows/sync-labels.yaml"),
      fix: "Add .github/workflows/sync-labels.yaml using the sync-labels workflow template",
      checks: [
        {
          name: "sync-labels workflow references sync-labels.reusable.yaml",
          check: () => fileContains(
            ".github/workflows/sync-labels.yaml",
            /uses:\s*(?:\.\/\.github\/workflows\/|williamthorsen\/node-monorepo-tools\/.github\/workflows\/)sync-labels\.reusable\.yaml/
          ),
          fix: "Update sync-labels.yaml to use williamthorsen/node-monorepo-tools/.github/workflows/sync-labels.reusable.yaml@sync-labels-workflow-v1"
        }
      ]
    },
    {
      name: ".github/labels.yaml exists",
      check: () => fileExists(".github/labels.yaml"),
      fix: "Add .github/labels.yaml with repo-specific label definitions (use release-kit sync-labels generate)"
    }
  ]
};
var default_default = definePreflightCollection({
  checklists: [syncLabels]
});
export {
  default_default as default
};
