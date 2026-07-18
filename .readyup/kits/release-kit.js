/** @noformat — @generated. Do not edit. Compiled by rdy. */
/* eslint-disable */
export const __readyupVersion = "0.21.2";


// .readyup/kits/release-kit.ts
import { defineRdyKit } from "readyup";
import {
  discoverWorkspaces,
  fileDoesNotContain,
  fileExists,
  fileMatchesHash,
  hasDevDependency,
  hasMinDevDependencyVersion,
  readFile
} from "readyup/check-utils";

// packages/release-kit/src/init/detectRepoType.ts
import { existsSync, readFileSync } from "node:fs";

// packages/release-kit/src/typeGuards.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// packages/release-kit/src/init/parseJsonRecord.ts
function parseJsonRecord(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return void 0;
  }
  return isRecord(parsed) ? parsed : void 0;
}

// packages/release-kit/src/init/detectRepoType.ts
function detectRepoType() {
  if (existsSync("pnpm-workspace.yaml")) {
    return "monorepo";
  }
  if (existsSync("package.json")) {
    const raw = readFileSync("package.json", "utf8");
    const pkg = parseJsonRecord(raw);
    if (pkg !== void 0 && Array.isArray(pkg.workspaces)) {
      return "monorepo";
    }
  }
  return "single-package";
}

// .readyup/kits/release-kit.ts
function getMinVersion() {
  const picked = { "version": "8.0.1" };
  if (typeof picked.version !== "string") {
    throw new TypeError("release-kit/package.json: 'version' must be a string");
  }
  return picked.version;
}
function hasPublishablePackages() {
  return discoverWorkspaces({ filter: (w) => w.isPackage }).length > 0;
}
var CLIFF_TEMPLATE_HASH = "bde3f6dba592e5ecdde2ec87503ccbbff8f5e48126319234c7e101d13db4bfd4";
var COMMON_PRESET_HASH = "25b1938b40006a00a39d291583d7cd2dabda699e1f4bfb0634ba49e7dffb3c45";
var SYNC_LABELS_WORKFLOW_HASH = "4dfde2454bac03280381f0da70c9c735916a7812100dec5437853b843c4bd797";
var RELEASE_WORKFLOW_HASH_MONOREPO = "0a9724b7b3c5e24087fd3a8f36fed8e990d699267fcf36028ce048ab40dc2946";
var RELEASE_WORKFLOW_HASH_SINGLE = "a3d19bbc1ba8bb30622e53c590137b97e3179e80988c0967737b021cdaeab73f";
var PUBLISH_WORKFLOW_HASH_MONOREPO = "0afa9ffe914f3dc8f043e68252ebc604c8cc1a953422fcea37a909a4def370ee";
var PUBLISH_WORKFLOW_HASH_SINGLE = "6f31183e0a1e66be791a19266c3b028dadbd9fe010f7fc4452f3f8970c937b43";
var release_kit_default = defineRdyKit({
  checklists: [
    {
      name: "release-kit",
      checks: [
        {
          name: "@williamthorsen/release-kit in devDependencies",
          severity: "error",
          check: () => hasDevDependency("@williamthorsen/release-kit"),
          fix: "pnpm add --save-dev @williamthorsen/release-kit",
          checks: [
            {
              get name() {
                return `@williamthorsen/release-kit >= ${getMinVersion()}`;
              },
              severity: "error",
              check: () => hasMinDevDependencyVersion("@williamthorsen/release-kit", getMinVersion(), {
                exempt: (range) => range.startsWith("workspace:")
              }),
              get fix() {
                return `pnpm add --save-dev @williamthorsen/release-kit@^${getMinVersion()}`;
              }
            }
          ]
        },
        {
          name: "release.yaml workflow exists",
          severity: "warn",
          check: () => fileExists(".github/workflows/release.yaml"),
          fix: "Add .github/workflows/release.yaml using the release workflow template",
          checks: [
            {
              name: "release.yaml matches template",
              severity: "warn",
              check: () => {
                const hash = detectRepoType() === "monorepo" ? RELEASE_WORKFLOW_HASH_MONOREPO : RELEASE_WORKFLOW_HASH_SINGLE;
                return fileMatchesHash(".github/workflows/release.yaml", hash);
              },
              fix: "Run `release-kit init --force` to regenerate release.yaml from the current template"
            },
            {
              name: "release.yaml does not reference deprecated tag ref",
              severity: "error",
              check: () => fileDoesNotContain(".github/workflows/release.yaml", /@(release|publish)-workflow-v[0-9]/),
              fix: "Update release.yaml to use @workflow/release-v1 (run `release-kit init --force` to regenerate, or replace the ref manually)"
            }
          ]
        },
        {
          name: "publish.yaml workflow exists",
          severity: "warn",
          skip: () => !hasPublishablePackages() ? "no publishable packages" : false,
          check: () => fileExists(".github/workflows/publish.yaml"),
          fix: "Add .github/workflows/publish.yaml using the publish workflow template",
          checks: [
            {
              name: "publish.yaml matches template",
              severity: "warn",
              check: () => {
                const hash = detectRepoType() === "monorepo" ? PUBLISH_WORKFLOW_HASH_MONOREPO : PUBLISH_WORKFLOW_HASH_SINGLE;
                return fileMatchesHash(".github/workflows/publish.yaml", hash);
              },
              fix: "Run `release-kit init --force` to regenerate publish.yaml from the current template"
            },
            {
              name: "publish.yaml does not reference deprecated tag ref",
              severity: "error",
              check: () => fileDoesNotContain(".github/workflows/publish.yaml", /@(release|publish)-workflow-v[0-9]/),
              fix: "Update publish.yaml to use @workflow/publish-v1 (run `release-kit init --force` to regenerate, or replace the ref manually)"
            }
          ]
        },
        {
          name: "releaseNotes config is consistent with changelogJson",
          severity: "warn",
          skip: () => !fileExists(".config/release-kit.config.ts") ? "no release-kit config file" : false,
          check: () => releaseNotesConfigIsConsistent(),
          fix: "Either enable changelogJson.enabled or disable releaseNotes.shouldInjectIntoReadme"
        },
        {
          name: "config does not use removed releaseNotes.shouldCreateGithubRelease",
          severity: "error",
          skip: () => !fileExists(".config/release-kit.config.ts") ? "no release-kit config file" : false,
          check: () => fileDoesNotContain(".config/release-kit.config.ts", /shouldCreateGithubRelease/),
          fix: "Remove 'shouldCreateGithubRelease' from .config/release-kit.config.ts. Adoption of GitHub Releases is now signaled by installing the create-github-release workflow (see release-kit README for setup)."
        },
        {
          name: "releaseNotes.shouldInjectIntoReadme is true",
          severity: "warn",
          skip: () => !fileExists(".config/release-kit.config.ts") ? "no release-kit config file" : false,
          check: () => releaseNotesInjectsIntoReadme(),
          fix: "Set releaseNotes.shouldInjectIntoReadme to true in .config/release-kit.config.ts",
          checks: [
            {
              name: "README contains release-notes section markers",
              severity: "warn",
              check: readmesHaveReleaseNotesMarkers,
              fix: "Add `<!-- section:release-notes -->` and `<!-- /section:release-notes -->` markers to each affected README"
            }
          ]
        },
        {
          name: "git-cliff not in devDependencies",
          severity: "recommend",
          check: () => !hasDevDependency("git-cliff"),
          fix: "pnpm remove git-cliff \u2014 release-kit handles changelog generation directly"
        },
        {
          name: ".config/git-cliff.toml matches current template",
          severity: "warn",
          skip: () => !fileExists(".config/git-cliff.toml") ? "no local cliff config (using fallback)" : false,
          check: () => fileMatchesHash(".config/git-cliff.toml", CLIFF_TEMPLATE_HASH),
          fix: "Update .config/git-cliff.toml to match the current cliff.toml.template from release-kit, or delete it to use the bundled fallback"
        },
        {
          name: "sync-labels.yaml workflow exists",
          severity: "warn",
          check: () => fileExists(".github/workflows/sync-labels.yaml"),
          fix: "Run `release-kit sync-labels init` to scaffold the workflow",
          checks: [
            {
              name: "sync-labels.yaml matches template",
              severity: "warn",
              check: () => fileMatchesHash(".github/workflows/sync-labels.yaml", SYNC_LABELS_WORKFLOW_HASH),
              fix: "Run `release-kit sync-labels init --force` to regenerate the workflow from the current template"
            }
          ]
        },
        {
          name: "sync-labels.yaml does not reference deprecated tag ref",
          severity: "error",
          check: () => fileDoesNotContain(".github/workflows/sync-labels.yaml", /@sync-labels-workflow-v[0-9]/),
          fix: "Update sync-labels.yaml to use @workflow/sync-labels-v1 (run `release-kit sync-labels init --force` to regenerate, or replace the ref manually)"
        },
        {
          name: ".config/sync-labels.config.ts exists",
          severity: "recommend",
          check: () => fileExists(".config/sync-labels.config.ts"),
          fix: "Run `release-kit sync-labels init` to scaffold the config, then customize labels"
        },
        {
          name: ".github/labels.yaml exists",
          severity: "warn",
          skip: () => !fileExists(".config/sync-labels.config.ts") ? "no sync-labels config" : false,
          check: () => fileExists(".github/labels.yaml"),
          fix: "Run `release-kit sync-labels generate` to produce the labels file",
          checks: [
            {
              name: "labels.yaml has current common preset",
              severity: "warn",
              check: () => labelsHaveCurrentPresetHash("common", COMMON_PRESET_HASH),
              fix: "Run `release-kit sync-labels generate` to incorporate updated common labels"
            }
          ]
        }
      ]
    }
  ]
});
function labelsHaveCurrentPresetHash(presetName, expectedHash) {
  const content = readFile(".github/labels.yaml");
  if (content === void 0) return false;
  const pattern = new RegExp(`^# ${presetName} preset hash: (.+)$`, "m");
  const match = pattern.exec(content);
  return match !== null && match[1] === expectedHash;
}
function readmeHasReleaseNotesMarkers(content) {
  return content.includes("<!-- section:release-notes -->") && content.includes("<!-- /section:release-notes -->");
}
function readmesHaveReleaseNotesMarkers() {
  const failing = [];
  for (const { dir } of discoverWorkspaces({ filter: (w) => w.isPackage })) {
    const readmePath = dir === "." ? "README.md" : `${dir}/README.md`;
    const content = readFile(readmePath);
    if (content === void 0 || !readmeHasReleaseNotesMarkers(content)) {
      failing.push(readmePath);
    }
  }
  if (failing.length === 0) return true;
  return {
    ok: false,
    detail: `missing markers or README: ${failing.join(", ")}`
  };
}
function releaseNotesConfigIsConsistent() {
  const content = readFile(".config/release-kit.config.ts");
  if (content === void 0) return true;
  const changelogJsonDisabled = /changelogJson\s*:\s*\{[^}]*enabled\s*:\s*false/.test(content);
  if (!changelogJsonDisabled) return true;
  const hasReadmeInjection = /shouldInjectIntoReadme\s*:\s*true/.test(content);
  return !hasReadmeInjection;
}
function releaseNotesInjectsIntoReadme() {
  const content = readFile(".config/release-kit.config.ts");
  if (content === void 0) return false;
  return /shouldInjectIntoReadme\s*:\s*true/.test(content);
}
export {
  CLIFF_TEMPLATE_HASH,
  COMMON_PRESET_HASH,
  PUBLISH_WORKFLOW_HASH_MONOREPO,
  PUBLISH_WORKFLOW_HASH_SINGLE,
  RELEASE_WORKFLOW_HASH_MONOREPO,
  RELEASE_WORKFLOW_HASH_SINGLE,
  SYNC_LABELS_WORKFLOW_HASH,
  release_kit_default as default,
  readmeHasReleaseNotesMarkers,
  readmesHaveReleaseNotesMarkers
};
