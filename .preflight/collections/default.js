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
function fileDoesNotContain(relativePath, pattern) {
  const content = readFile(relativePath);
  if (content === void 0) return true;
  return !pattern.test(content);
}

// packages/preflight/dist/esm/isRecord.js
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// packages/preflight/dist/esm/check-utils/package-json.js
function readPackageJson() {
  const content = readFile("package.json");
  if (content === void 0) return void 0;
  const parsed = JSON.parse(content);
  if (!isRecord(parsed)) return void 0;
  return Object.fromEntries(Object.entries(parsed));
}
function hasPackageJsonField(field, expectedValue) {
  const pkg = readPackageJson();
  if (pkg === void 0) return false;
  if (expectedValue !== void 0) return pkg[field] === expectedValue;
  return field in pkg;
}

// .preflight/collections/default.ts
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
var default_default = definePreflightCollection({
  checklists: [syncLabels, codeQuality, repoSetup]
});
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
  default_default as default
};
