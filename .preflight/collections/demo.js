/** @noformat — @generated. Do not edit. Compiled by preflight. */
/* eslint-disable */


// .preflight/collections/demo.ts
import { execFileSync } from "node:child_process";

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
function hasDevDependency(name) {
  const pkg = readPackageJson();
  if (pkg === void 0) return false;
  const devDeps = pkg.devDependencies;
  return isRecord(devDeps) && name in devDeps;
}

// .preflight/collections/demo.ts
function commandExists(name) {
  try {
    execFileSync("which", [name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
var projectFoundations = {
  name: "project-foundations",
  preconditions: [
    {
      name: "package.json exists",
      check: () => fileExists("package.json")
    }
  ],
  checks: [
    {
      name: 'ESM project ("type": "module")',
      check: () => hasPackageJsonField("type", "module"),
      fix: 'Add "type": "module" to package.json'
    },
    {
      name: "packageManager field is set",
      check: () => hasPackageJsonField("packageManager"),
      fix: 'Add "packageManager" to package.json (e.g., "pnpm@10.x.x")'
    },
    {
      name: "pnpm-workspace.yaml exists",
      check: () => fileExists("pnpm-workspace.yaml"),
      fix: "Create pnpm-workspace.yaml with workspace package globs",
      checks: [
        {
          name: "workspace includes packages/*",
          check: () => fileContains("pnpm-workspace.yaml", /packages\/\*/)
        }
      ]
    },
    {
      name: ".editorconfig exists",
      check: () => fileExists(".editorconfig"),
      fix: "Add .editorconfig to repo root"
    },
    {
      name: "jq is installed",
      severity: "warn",
      check: () => commandExists("jq"),
      fix: "brew install jq \u2014 required for JSON processing in shell scripts and CI pipelines"
    }
  ]
};
var ciWorkflows = {
  name: "ci-workflows",
  checks: [
    {
      name: "actionlint is installed",
      severity: "warn",
      check: () => commandExists("actionlint"),
      fix: "brew install actionlint \u2014 catches workflow syntax errors before they fail in CI",
      checks: [
        {
          name: "shellcheck is installed",
          severity: "warn",
          check: () => commandExists("shellcheck"),
          fix: "brew install shellcheck \u2014 actionlint uses shellcheck to lint run: blocks in workflows"
        }
      ]
    },
    {
      name: "code-quality.yaml workflow exists",
      check: () => fileExists(".github/workflows/code-quality.yaml"),
      checks: [
        {
          name: "references reusable workflow",
          check: () => fileContains(
            ".github/workflows/code-quality.yaml",
            /uses:\s*williamthorsen\/.github\/.github\/workflows\/code-quality-pnpm-workflow\.yaml/
          )
        }
      ]
    },
    {
      name: "deploy-preview.yaml workflow exists",
      severity: "warn",
      check: () => fileExists(".github/workflows/deploy-preview.yaml"),
      fix: "Add .github/workflows/deploy-preview.yaml for PR preview deployments",
      checks: [
        {
          name: "references staging environment",
          severity: "warn",
          check: () => fileContains(".github/workflows/deploy-preview.yaml", /environment:\s*staging/)
        },
        {
          name: "pins runner to ubuntu-latest",
          severity: "warn",
          check: () => fileContains(".github/workflows/deploy-preview.yaml", /runs-on:\s*ubuntu-latest/)
        }
      ]
    }
  ]
};
var optionalIntegrations = {
  name: "optional-integrations",
  checks: [
    {
      name: "Docker",
      skip: () => !fileExists("Dockerfile") ? "no Dockerfile" : false,
      check: () => true,
      checks: [
        {
          name: "docker-compose.yaml exists",
          check: () => fileExists("docker-compose.yaml")
        }
      ]
    },
    {
      name: "Renovate",
      skip: () => !fileExists("renovate.json") ? "no renovate.json" : false,
      check: () => true,
      checks: [
        {
          name: "extends recommended preset",
          check: () => fileContains("renovate.json", /extends.*config:recommended/)
        }
      ]
    },
    {
      name: "lefthook in devDependencies",
      check: () => hasDevDependency("lefthook"),
      fix: "pnpm add --save-dev lefthook",
      checks: [
        {
          name: "lefthook.yml exists",
          check: () => fileExists("lefthook.yml"),
          fix: "Add lefthook.yml for git hook management",
          checks: [
            {
              name: "pre-commit hook configured",
              check: () => fileContains("lefthook.yml", /pre-commit:/),
              fix: "Add a pre-commit section to lefthook.yml",
              checks: [
                {
                  name: "formatter runs on pre-commit",
                  check: () => fileContains("lefthook.yml", /prettier/),
                  checks: [
                    {
                      name: "unknown files are ignored",
                      check: () => fileContains("lefthook.yml", /--ignore-unknown/)
                    }
                  ]
                },
                {
                  name: "linter runs on pre-commit",
                  severity: "recommend",
                  check: () => fileContains("lefthook.yml", /eslint|lint/),
                  fix: "Add an ESLint command to the pre-commit hook"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
};
var publishingPipeline = {
  name: "publishing-pipeline",
  groups: [
    // Stage 1: Build infrastructure — can the project compile at all?
    [
      {
        name: "shared build script exists",
        check: () => fileExists("config/build.ts"),
        fix: "Add config/build.ts \u2014 packages depend on the shared esbuild configuration"
      },
      {
        name: "shared Vitest config exists",
        check: () => fileExists("config/vitest.config.ts"),
        fix: "Add config/vitest.config.ts \u2014 packages inherit the shared test configuration"
      }
    ],
    // Stage 2: Compliance — is the project legally publishable?
    // npm publish warns on missing license; corporate consumers cannot use unlicensed packages.
    [
      {
        name: "LICENSE file exists",
        check: () => fileExists("LICENSE") || fileExists("LICENSE.md"),
        fix: "Add a LICENSE file \u2014 npm publish will warn and corporate consumers cannot use unlicensed packages"
      },
      {
        name: ".npmrc configures save-exact",
        check: () => fileContains(".npmrc", /save-exact\s*=\s*true/),
        fix: "Add save-exact=true to .npmrc for reproducible installs"
      }
    ],
    // Stage 3: Release automation — are the workflows in place?
    // No point verifying release workflows if the package can't be legally published.
    [
      {
        name: "release workflow exists",
        check: () => fileExists(".github/workflows/release.yaml")
      },
      {
        name: "publish workflow exists",
        check: () => fileExists(".github/workflows/publish.yaml")
      }
    ]
  ],
  fixLocation: "inline"
};
var demo_default = definePreflightCollection({
  checklists: [projectFoundations, ciWorkflows, optionalIntegrations, publishingPipeline]
});
export {
  demo_default as default
};
