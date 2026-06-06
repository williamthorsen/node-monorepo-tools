/** @noformat — @generated. Do not edit. Compiled by rdy. */
/* eslint-disable */
export const __readyupVersion = "0.21.1";


// .readyup/kits/default.ts
import { defineRdyKit } from "readyup";
import { fileContains, fileExists } from "readyup/check-utils";
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
          fix: "Update sync-labels.yaml to use williamthorsen/node-monorepo-tools/.github/workflows/sync-labels.reusable.yaml@workflow/sync-labels-v1"
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
var default_default = defineRdyKit({
  checklists: [syncLabels]
});
export {
  default_default as default
};
