/** @noformat — @generated. Do not edit. Compiled by rdy. */
/* eslint-disable */


// .readyup/kits/release-kit.ts
import { existsSync as existsSync3, readdirSync } from "node:fs";
import { join as join2 } from "node:path";

// node_modules/.pnpm/readyup@0.17.0_esbuild@0.28.0/node_modules/readyup/dist/esm/authoring.js
function defineRdyKit(kit) {
  return kit;
}

// node_modules/.pnpm/readyup@0.17.0_esbuild@0.28.0/node_modules/readyup/dist/esm/isRecord.js
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// node_modules/.pnpm/readyup@0.17.0_esbuild@0.28.0/node_modules/readyup/dist/esm/check-utils/filesystem.js
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
function fileDoesNotContain(relativePath, pattern) {
  const content = readFile(relativePath);
  if (content === void 0) return true;
  return !pattern.test(content);
}

// node_modules/.pnpm/readyup@0.17.0_esbuild@0.28.0/node_modules/readyup/dist/esm/check-utils/git/run-git.js
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);

// node_modules/.pnpm/readyup@0.17.0_esbuild@0.28.0/node_modules/readyup/dist/esm/check-utils/hashing.js
import { createHash } from "node:crypto";
function computeHash(content) {
  return createHash("sha256").update(content).digest("hex");
}
function fileMatchesHash(relativePath, expectedHash) {
  const content = readFile(relativePath);
  if (content === void 0) return false;
  return computeHash(content) === expectedHash;
}

// node_modules/.pnpm/readyup@0.17.0_esbuild@0.28.0/node_modules/readyup/dist/esm/safeJsonParse.js
function safeJsonParse(content) {
  try {
    const parsed = JSON.parse(content);
    return parsed;
  } catch {
    return void 0;
  }
}

// node_modules/.pnpm/readyup@0.17.0_esbuild@0.28.0/node_modules/readyup/dist/esm/check-utils/json.js
function readJsonFile(relativePath) {
  const content = readFile(relativePath);
  if (content === void 0) return void 0;
  const parsed = safeJsonParse(content);
  if (!isRecord(parsed)) return void 0;
  return parsed;
}

// node_modules/.pnpm/readyup@0.17.0_esbuild@0.28.0/node_modules/readyup/dist/esm/check-utils/semver.js
function compareVersions(a, b) {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// node_modules/.pnpm/readyup@0.17.0_esbuild@0.28.0/node_modules/readyup/dist/esm/check-utils/package-json.js
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

// packages/release-kit/src/init/detectRepoType.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";

// packages/release-kit/src/typeGuards.ts
function isRecord2(value) {
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
  return isRecord2(parsed) ? parsed : void 0;
}

// packages/release-kit/src/init/detectRepoType.ts
function detectRepoType() {
  if (existsSync2("pnpm-workspace.yaml")) {
    return "monorepo";
  }
  if (existsSync2("package.json")) {
    const raw = readFileSync2("package.json", "utf8");
    const pkg = parseJsonRecord(raw);
    if (pkg !== void 0 && Array.isArray(pkg.workspaces)) {
      return "monorepo";
    }
  }
  return "single-package";
}

// .readyup/kits/release-kit.ts
function getMinVersion() {
  const picked = { "version": "5.0.0" };
  if (typeof picked.version !== "string") {
    throw new TypeError("release-kit/package.json: 'version' must be a string");
  }
  return picked.version;
}
var CLIFF_TEMPLATE_HASH = "520ffdde4cbbef671f229d1e1f63c09a3c4ef0b2d76208386e372419d18065c7";
var COMMON_PRESET_HASH = "d12ffccbd5e4d9af8ecf47744b143f6c9f80bcf5e496cf1983b66834f0ae7825";
var SYNC_LABELS_WORKFLOW_HASH = "4dfde2454bac03280381f0da70c9c735916a7812100dec5437853b843c4bd797";
var RELEASE_WORKFLOW_HASH_MONOREPO = "88df0ab3c5f5f32cee35f3b38639e96df0a4c92f57862166f7894e70327b3bbe";
var RELEASE_WORKFLOW_HASH_SINGLE = "d80f814468897d920c89ab55959f6c1f97efbd02b99522c92b9d1162ed694c1c";
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
            }
          ]
        },
        {
          name: "release.yaml does not reference deprecated tag ref",
          severity: "error",
          check: () => fileDoesNotContain(".github/workflows/release.yaml", /@(release|publish)-workflow-v[0-9]/),
          fix: "Update release.yaml to use @workflow/release-v1 (run `release-kit init --force` to regenerate, or replace the ref manually)"
        },
        {
          name: "publish.yaml workflow exists",
          severity: "warn",
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
            }
          ]
        },
        {
          name: "publish.yaml does not reference deprecated tag ref",
          severity: "error",
          check: () => fileDoesNotContain(".github/workflows/publish.yaml", /@(release|publish)-workflow-v[0-9]/),
          fix: "Update publish.yaml to use @workflow/publish-v1 (run `release-kit init --force` to regenerate, or replace the ref manually)"
        },
        {
          name: "config does not use removed tagPrefix",
          severity: "error",
          skip: () => !fileExists(".config/release-kit.config.ts") ? "no release-kit config file" : false,
          check: () => fileDoesNotContain(".config/release-kit.config.ts", /tagPrefix/),
          fix: "Remove 'tagPrefix' from .config/release-kit.config.ts \u2014 it is no longer supported; the default is derived from the unscoped package.json name (e.g., '{unscoped-name}-v')"
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
function readmeHasReleaseNotesMarkers(content) {
  return content.includes("<!-- section:release-notes -->") && content.includes("<!-- /section:release-notes -->");
}
function readmesHaveReleaseNotesMarkers() {
  if (detectRepoType() === "single-package") {
    const content = readFile("README.md");
    return content !== void 0 && readmeHasReleaseNotesMarkers(content);
  }
  const failing = [];
  for (const { dir } of getPublishablePackages()) {
    const content = readFile(`${dir}/README.md`);
    if (content === void 0 || !readmeHasReleaseNotesMarkers(content)) {
      failing.push(`${dir}/README.md`);
    }
  }
  if (failing.length === 0) return true;
  return {
    ok: false,
    detail: `missing markers or README: ${failing.join(", ")}`
  };
}
function labelsHaveCurrentPresetHash(presetName, expectedHash) {
  const content = readFile(".github/labels.yaml");
  if (content === void 0) return false;
  const pattern = new RegExp(`^# ${presetName} preset hash: (.+)$`, "m");
  const match = pattern.exec(content);
  return match !== null && match[1] === expectedHash;
}
function getPublishablePackages() {
  const packagesDir = join2(process.cwd(), "packages");
  if (!existsSync3(packagesDir)) return [];
  const entries = readdirSync(packagesDir, { withFileTypes: true });
  const publishable = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = `packages/${entry.name}`;
    const content = readFile(`${dir}/package.json`);
    if (content === void 0) continue;
    const pkg = parseJsonRecord(content);
    if (pkg?.private === true) continue;
    publishable.push({ dir });
  }
  return publishable;
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
  getPublishablePackages,
  readmeHasReleaseNotesMarkers,
  readmesHaveReleaseNotesMarkers
};
