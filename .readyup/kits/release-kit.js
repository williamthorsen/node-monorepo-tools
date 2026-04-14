/** @noformat — @generated. Do not edit. Compiled by rdy. */
/* eslint-disable */


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
function fileContains(relativePath, pattern) {
  const content = readFile(relativePath);
  if (content === void 0) return false;
  return pattern.test(content);
}
function fileDoesNotContain(relativePath, pattern) {
  const content = readFile(relativePath);
  if (content === void 0) return true;
  return !pattern.test(content);
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

// packages/release-kit/package.json
var package_default = {
  name: "@williamthorsen/release-kit",
  version: "4.5.1",
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

// .readyup/kits/release-kit.ts
var MIN_VERSION = package_default.version;
var CLIFF_TEMPLATE_HASH = "8bddb90021f6e501ce4c3b014185b1181e6d1c7be049468f3773e852a8874308";
var COMMON_PRESET_HASH = "d12ffccbd5e4d9af8ecf47744b143f6c9f80bcf5e496cf1983b66834f0ae7825";
var SYNC_LABELS_WORKFLOW_HASH = "c0206871afadf1bf12a8dbe51afbd8e6d49724ca48875c168fbf1da891abcfad";
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
              name: "release workflow references release.reusable.yaml",
              severity: "warn",
              check: () => fileContains(
                ".github/workflows/release.yaml",
                /uses:\s*(?:\.\/\.github\/workflows\/|williamthorsen\/node-monorepo-tools\/.github\/workflows\/)release\.reusable\.yaml/
              ),
              fix: "Update release.yaml to use williamthorsen/node-monorepo-tools/.github/workflows/release.reusable.yaml@release-workflow-v1"
            }
          ]
        },
        {
          name: "publish.yaml workflow exists",
          severity: "warn",
          check: () => fileExists(".github/workflows/publish.yaml"),
          fix: "Add .github/workflows/publish.yaml using the publish workflow template",
          checks: [
            {
              name: "publish workflow references publish.reusable.yaml",
              severity: "warn",
              check: () => fileContains(
                ".github/workflows/publish.yaml",
                /uses:\s*(?:\.\/\.github\/workflows\/|williamthorsen\/node-monorepo-tools\/.github\/workflows\/)publish\.reusable\.yaml/
              ),
              fix: "Update publish.yaml to use williamthorsen/node-monorepo-tools/.github/workflows/publish.reusable.yaml@publish-workflow-v1"
            }
          ]
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
  SYNC_LABELS_WORKFLOW_HASH,
  release_kit_default as default
};
