/** @noformat — @generated. Do not edit. Compiled by rdy. */
/* eslint-disable */


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

// packages/release-kit/package.json
var package_default = {
  name: "@williamthorsen/release-kit",
  version: "4.8.0",
  description: "Version-bumping and changelog-generation toolkit for release workflows",
  keywords: [],
  homepage: "https://github.com/williamthorsen/node-monorepo-tools/tree/main/packages/release-kit#readme",
  bugs: {
    url: "https://github.com/williamthorsen/node-monorepo-tools/issues"
  },
  repository: {
    type: "git",
    url: "https://github.com/williamthorsen/node-monorepo-tools.git",
    directory: "packages/release-kit"
  },
  license: "ISC",
  author: "William Thorsen <william@thorsen.dev> (https://github.com/williamthorsen)",
  type: "module",
  exports: {
    ".": {
      import: "./dist/esm/index.js"
    }
  },
  bin: {
    "release-kit": "./bin/release-kit.js"
  },
  files: [
    "bin",
    "dist/*",
    "cliff.toml.template",
    "presets/**",
    "CHANGELOG.md"
  ],
  scripts: {
    prepare: "tsx ../../config/generateVersion.ts && tsx ../../config/build.ts && tsc --project tsconfig.generate-typings.json",
    prepublishOnly: "nmr build",
    test: "pnpm exec vitest --config=vitest.standalone.config.ts",
    "test:coverage": "pnpm exec vitest --config=vitest.standalone.config.ts --coverage",
    "test:integration": "pnpm exec vitest --config=vitest.integration.config.ts",
    "test:watch": "pnpm exec vitest --config=vitest.standalone.config.ts --watch"
  },
  dependencies: {
    "@williamthorsen/node-monorepo-core": "workspace:*",
    glob: "13.0.6",
    jiti: "2.6.1",
    "js-yaml": "4.1.1",
    "json-stringify-pretty-compact": "4.0.0"
  },
  devDependencies: {
    "@types/js-yaml": "4.0.9",
    "smol-toml": "1.6.1"
  },
  engines: {
    node: ">=18.17.0"
  },
  publishConfig: {
    access: "public",
    registry: "https://registry.npmjs.org"
  }
};

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
var MIN_VERSION = package_default.version;
var CLIFF_TEMPLATE_HASH = "520ffdde4cbbef671f229d1e1f63c09a3c4ef0b2d76208386e372419d18065c7";
var COMMON_PRESET_HASH = "d12ffccbd5e4d9af8ecf47744b143f6c9f80bcf5e496cf1983b66834f0ae7825";
var SYNC_LABELS_WORKFLOW_HASH = "4dfde2454bac03280381f0da70c9c735916a7812100dec5437853b843c4bd797";
var RELEASE_WORKFLOW_HASH_MONOREPO = "d2c297a3974a70485c73ec115c092ecba0d571b5238d5f440096d6a35b64810b";
var RELEASE_WORKFLOW_HASH_SINGLE = "d80f814468897d920c89ab55959f6c1f97efbd02b99522c92b9d1162ed694c1c";
var PUBLISH_WORKFLOW_HASH_MONOREPO = "ba9f8e353e0f60498df8b55a9340bd1b88c3b9f55e9862850da26dd9c98d8b23";
var PUBLISH_WORKFLOW_HASH_SINGLE = "4abbafa80eab871ce5277751e86d0c057490b0b36ec6e4e06a41f39494c990b1";
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
              name: `@williamthorsen/release-kit >= ${MIN_VERSION}`,
              severity: "error",
              check: () => hasMinDevDependencyVersion("@williamthorsen/release-kit", MIN_VERSION, {
                exempt: (range) => range.startsWith("workspace:")
              }),
              fix: `pnpm add --save-dev @williamthorsen/release-kit@^${MIN_VERSION}`
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
          fix: "Remove 'tagPrefix' from .config/release-kit.config.ts \u2014 it is no longer supported; the default '{dir}-v' is used automatically"
        },
        {
          name: "releaseNotes config is consistent with changelogJson",
          severity: "warn",
          skip: () => !fileExists(".config/release-kit.config.ts") ? "no release-kit config file" : false,
          check: () => releaseNotesConfigIsConsistent(),
          fix: "Either enable changelogJson.enabled or disable releaseNotes features (shouldCreateGithubRelease, shouldInjectIntoReadme)"
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
  const hasGithubRelease = /shouldCreateGithubRelease\s*:\s*true/.test(content);
  const hasReadmeInjection = /shouldInjectIntoReadme\s*:\s*true/.test(content);
  return !hasGithubRelease && !hasReadmeInjection;
}
function labelsHaveCurrentPresetHash(presetName, expectedHash) {
  const content = readFile(".github/labels.yaml");
  if (content === void 0) return false;
  const pattern = new RegExp(`^# ${presetName} preset hash: (.+)$`, "m");
  const match = pattern.exec(content);
  return match !== null && match[1] === expectedHash;
}
export {
  CLIFF_TEMPLATE_HASH,
  COMMON_PRESET_HASH,
  PUBLISH_WORKFLOW_HASH_MONOREPO,
  PUBLISH_WORKFLOW_HASH_SINGLE,
  RELEASE_WORKFLOW_HASH_MONOREPO,
  RELEASE_WORKFLOW_HASH_SINGLE,
  SYNC_LABELS_WORKFLOW_HASH,
  release_kit_default as default
};
