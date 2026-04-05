/** @noformat — @generated. Do not edit. Compiled by preflight. */
/* eslint-disable */


// packages/preflight/dist/esm/authoring.js
function definePreflightCollection(collection) {
  return collection;
}

// .preflight/collections/nmr.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
var releaseKit = {
  name: "release-kit",
  checks: [
    {
      name: "@williamthorsen/release-kit >= 4.0.0 in devDependencies",
      check: () => hasMinDevDependencyVersion("@williamthorsen/release-kit", "4.0.0", {
        exempt: (range) => range.startsWith("workspace:")
      }),
      fix: "pnpm add --save-dev @williamthorsen/release-kit@^4.0.0"
    },
    {
      name: "release.yaml workflow exists",
      check: () => fileExists(".github/workflows/release.yaml"),
      fix: "Add .github/workflows/release.yaml using the release workflow template"
    },
    {
      name: "release workflow references release.reusable.yaml",
      check: () => fileContains(
        ".github/workflows/release.yaml",
        /uses:\s*(?:\.\/\.github\/workflows\/|williamthorsen\/node-monorepo-tools\/.github\/workflows\/)release\.reusable\.yaml/
      ),
      fix: "Update release.yaml to use williamthorsen/node-monorepo-tools/.github/workflows/release.reusable.yaml@release-workflow-v1"
    },
    {
      name: "publish.yaml workflow exists",
      check: () => fileExists(".github/workflows/publish.yaml"),
      fix: "Add .github/workflows/publish.yaml using the publish workflow template"
    },
    {
      name: "publish workflow references publish.reusable.yaml",
      check: () => fileContains(
        ".github/workflows/publish.yaml",
        /uses:\s*(?:\.\/\.github\/workflows\/|williamthorsen\/node-monorepo-tools\/.github\/workflows\/)publish\.reusable\.yaml/
      ),
      fix: "Update publish.yaml to use williamthorsen/node-monorepo-tools/.github/workflows/publish.reusable.yaml@publish-workflow-v1"
    }
  ]
};
var syncLabels = {
  name: "sync-labels",
  checks: [
    {
      name: "sync-labels.yaml workflow exists",
      check: () => fileExists(".github/workflows/sync-labels.yaml"),
      fix: "Add .github/workflows/sync-labels.yaml using the sync-labels workflow template"
    },
    {
      name: "sync-labels workflow references sync-labels.reusable.yaml",
      check: () => fileContains(
        ".github/workflows/sync-labels.yaml",
        /uses:\s*(?:\.\/\.github\/workflows\/|williamthorsen\/node-monorepo-tools\/.github\/workflows\/)sync-labels\.reusable\.yaml/
      ),
      fix: "Update sync-labels.yaml to use williamthorsen/node-monorepo-tools/.github/workflows/sync-labels.reusable.yaml@sync-labels-workflow-v1"
    },
    {
      name: ".github/labels.yaml exists",
      check: () => fileExists(".github/labels.yaml"),
      fix: "Add .github/labels.yaml with repo-specific label definitions (use release-kit sync-labels generate)"
    }
  ]
};
var nmr = {
  name: "nmr",
  checks: [
    {
      name: "@williamthorsen/nmr in devDependencies",
      check: () => hasDevDependency("@williamthorsen/nmr"),
      fix: "pnpm add --save-dev @williamthorsen/nmr"
    },
    {
      name: "__tests__/version-alignment.app.test.ts exists",
      check: () => fileExists("__tests__/version-alignment.app.test.ts"),
      fix: "Add __tests__/version-alignment.app.test.ts with version-alignment checks"
    },
    {
      name: "version-alignment test contains checkNodeVersionConsistency (requires file)",
      check: () => !fileExists("__tests__/version-alignment.app.test.ts") || fileContains("__tests__/version-alignment.app.test.ts", /checkNodeVersionConsistency/),
      fix: "Update __tests__/version-alignment.app.test.ts to use checkNodeVersionConsistency"
    },
    {
      name: "version-alignment test does not contain runConsistencyChecks (requires file)",
      check: () => !fileExists("__tests__/version-alignment.app.test.ts") || fileDoesNotContain("__tests__/version-alignment.app.test.ts", /runConsistencyChecks/),
      fix: "Replace runConsistencyChecks with checkNodeVersionConsistency in __tests__/version-alignment.app.test.ts"
    },
    {
      name: "__tests__/consistency.app.test.ts does not exist",
      check: () => !fileExists("__tests__/consistency.app.test.ts"),
      fix: "Remove __tests__/consistency.app.test.ts \u2014 superseded by __tests__/version-alignment.app.test.ts"
    },
    {
      name: "__tests__/nodejs-version-app.test.ts does not exist",
      check: () => !fileExists("__tests__/nodejs-version-app.test.ts"),
      fix: "Remove __tests__/nodejs-version-app.test.ts \u2014 superseded by __tests__/version-alignment.app.test.ts"
    },
    {
      name: "__tests__/pnpm-version-app.test.ts does not exist",
      check: () => !fileExists("__tests__/pnpm-version-app.test.ts"),
      fix: "Remove __tests__/pnpm-version-app.test.ts \u2014 superseded by __tests__/version-alignment.app.test.ts"
    }
  ]
};
var codeQuality = {
  name: "code-quality",
  checks: [
    {
      name: "code-quality.yaml workflow exists",
      check: () => fileExists(".github/workflows/code-quality.yaml"),
      fix: "Add .github/workflows/code-quality.yaml using the code-quality workflow template"
    },
    {
      name: "code-quality workflow references @v5",
      check: () => fileContains(
        ".github/workflows/code-quality.yaml",
        /uses:\s*williamthorsen\/.github\/.github\/workflows\/code-quality-pnpm-workflow\.yaml@v5/
      ),
      fix: "Update code-quality.yaml to reference code-quality-pnpm-workflow.yaml@v5"
    },
    {
      name: "code-quality workflow does not reference pnpm-version (requires @v5)",
      check: () => !fileContains(
        ".github/workflows/code-quality.yaml",
        /uses:\s*williamthorsen\/.github\/.github\/workflows\/code-quality-pnpm-workflow\.yaml@v5/
      ) || fileDoesNotContain(".github/workflows/code-quality.yaml", /pnpm-version/),
      fix: "Remove pnpm-version from code-quality.yaml \u2014 v5 workflow infers the version from packageManager"
    },
    {
      name: "code-quality workflow does not reference GH_PACKAGES_TOKEN",
      check: () => fileDoesNotContain(".github/workflows/code-quality.yaml", /GH_PACKAGES_TOKEN/),
      fix: "Remove all references to GH_PACKAGES_TOKEN from code-quality.yaml"
    }
  ]
};
var repoSetupChecks = [
  {
    name: ".envrc exists",
    check: () => fileExists(".envrc"),
    fix: "Add .envrc to repo root"
  },
  {
    name: ".config/wt.toml exists",
    check: () => fileExists(".config/wt.toml"),
    fix: "Add .config/wt.toml for worktree configuration"
  },
  {
    name: ".editorconfig exists",
    check: () => fileExists(".editorconfig"),
    fix: "Add .editorconfig to repo root"
  },
  {
    name: "lefthook.yml exists",
    check: () => fileExists("lefthook.yml"),
    fix: "Add lefthook.yml for git hook management"
  },
  {
    name: ".claude/CLAUDE.md exists",
    check: () => fileExists(".claude/CLAUDE.md"),
    fix: "Add .claude/CLAUDE.md with project-specific agent instructions"
  },
  {
    name: ".agents/PROJECT.md exists",
    check: () => fileExists(".agents/PROJECT.md"),
    fix: "Add .agents/PROJECT.md with project context for AI agents"
  },
  {
    name: ".agents/preferences.yaml has project.slug and project.ticket_prefix",
    check: () => preferencesHasRequiredFields(),
    fix: "Add .agents/preferences.yaml with project.slug and project.ticket_prefix fields"
  },
  {
    name: ".audit-ci/config.dev.json5 exists",
    check: () => fileExists(".audit-ci/config.dev.json5"),
    fix: "Add .audit-ci/config.dev.json5 for dev dependency audit configuration"
  },
  {
    name: ".audit-ci/config.prod.json5 exists",
    check: () => fileExists(".audit-ci/config.prod.json5"),
    fix: "Add .audit-ci/config.prod.json5 for prod dependency audit configuration"
  },
  {
    name: 'package.json has "type": "module"',
    check: () => hasPackageJsonField("type", "module"),
    fix: 'Add "type": "module" to package.json'
  },
  {
    name: "package.json has packageManager field",
    check: () => hasPackageJsonField("packageManager"),
    fix: 'Add "packageManager" field to package.json (e.g., "pnpm@10.33.0")'
  },
  {
    name: ".tool-versions does not contain pnpm",
    check: () => toolVersionsHasNoPnpm(),
    fix: "Remove pnpm from .tool-versions \u2014 manage via packageManager field and corepack"
  }
];
var repoSetup = {
  name: "repo-setup",
  checks: repoSetupChecks
};
var nmr_default = definePreflightCollection({
  checklists: [releaseKit, syncLabels, nmr, codeQuality, repoSetup]
});
function fileExists(relativePath) {
  return existsSync(join(process.cwd(), relativePath));
}
function readFile(relativePath) {
  const fullPath = join(process.cwd(), relativePath);
  if (!existsSync(fullPath)) return void 0;
  return readFileSync(fullPath, "utf8");
}
function readPackageJson() {
  const content = readFile("package.json");
  if (content === void 0) return void 0;
  const parsed = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
  return Object.fromEntries(Object.entries(parsed));
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
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
  const versionMatch = /(\d+\.\d+\.\d+)/.exec(range);
  if (versionMatch === null) return false;
  return compareVersions(versionMatch[1], minVersion) >= 0;
}
function compareVersions(a, b) {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
function hasPackageJsonField(field, expectedValue) {
  const pkg = readPackageJson();
  if (pkg === void 0) return false;
  if (expectedValue !== void 0) return pkg[field] === expectedValue;
  return field in pkg;
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
function preferencesHasRequiredFields() {
  const content = readFile(".agents/preferences.yaml");
  if (content === void 0) return false;
  const hasSlug = /^\s+slug:\s*\S/m.test(content);
  const hasTicketPrefix = /^\s+ticket_prefix:\s*\S/m.test(content);
  return hasSlug && hasTicketPrefix;
}
function toolVersionsHasNoPnpm() {
  const content = readFile(".tool-versions");
  if (content === void 0) return true;
  return !/^pnpm\s/m.test(content);
}
export {
  nmr_default as default
};
