/** @noformat — @generated. Do not edit. Compiled by rdy. */
/* eslint-disable */
export const __readyupVersion = "0.21.0";


// .readyup/kits/npm-auto-publish.ts
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  defineRdyChecklist,
  defineRdyKit,
  defineRdyStagedChecklist
} from "readyup";
import {
  discoverWorkspaces,
  fileContains,
  fileExists,
  getJsonValue,
  isRecord,
  readFile,
  readJsonFile
} from "readyup/check-utils";
var PUBLISH_WORKFLOW_FILE = "publish.yaml";
var cachedOwnerRepo;
function getCachedOwnerRepo() {
  if (cachedOwnerRepo === void 0) {
    cachedOwnerRepo = getOwnerRepo();
  }
  return cachedOwnerRepo;
}
var repoChecklist = defineRdyStagedChecklist({
  name: "repo",
  preconditions: [
    {
      name: "publish.yaml exists",
      check: () => fileExists(".github/workflows/publish.yaml"),
      fix: 'Run "release-kit init" to scaffold the publish workflow, or create .github/workflows/publish.yaml manually'
    }
  ],
  groups: [
    [
      {
        name: "id-token: write permission declared",
        check: () => fileContains(".github/workflows/publish.yaml", /id-token:\s*write/),
        fix: 'Add "permissions: { id-token: write, contents: read }" to .github/workflows/publish.yaml \u2014 required for OIDC-based npm authentication'
      },
      {
        name: "No legacy token references in workflow files",
        check: () => !hasTokenReferences(),
        fix: "Remove NPM_TOKEN/NODE_AUTH_TOKEN references from workflow files; OIDC auth replaces token-based auth"
      },
      {
        name: "Provenance setting matches repo visibility",
        check: checkProvenanceMatchesVisibility
      }
    ]
  ]
});
var packagesChecklist = defineRdyChecklist({
  name: "packages",
  preconditions: [
    {
      name: 'packageManager field starts with "pnpm"',
      check: () => {
        const rootPkg = readJsonFile("package.json");
        const pm = typeof rootPkg?.packageManager === "string" ? rootPkg.packageManager : "";
        return pm.startsWith("pnpm");
      },
      fix: 'Set "packageManager": "pnpm@..." in root package.json'
    },
    {
      name: "At least one workspace discovered",
      check: () => discoverWorkspaces().length > 0,
      fix: "Ensure pnpm-workspace.yaml lists package globs, or that a root package.json exists"
    }
  ],
  get checks() {
    return discoverWorkspaces().map((workspace) => buildWorkspaceCheck(workspace));
  }
});
var npm_auto_publish_default = defineRdyKit({
  fixLocation: "inline",
  checklists: [repoChecklist, packagesChecklist]
});
function skipIfNotPublishable(workspace) {
  return workspace.isPackage ? false : "package.json#private is true";
}
function buildWorkspaceCheck(workspace) {
  const displayName = workspace.name ?? "(unnamed)";
  const pkgJsonPath = path.join(workspace.dir, "package.json");
  const children = [
    {
      name: "repository field exists",
      check: () => workspace.packageJson.repository !== void 0 && workspace.packageJson.repository !== null,
      fix: `Add a "repository" field to ${pkgJsonPath} pointing to the GitHub repo`
    }
  ];
  if (workspace.name?.startsWith("@")) {
    children.push({
      name: 'publishConfig.access is "public"',
      check: () => {
        const access = getJsonValue(workspace.packageJson, "publishConfig", "access");
        return typeof access === "string" && access === "public";
      },
      fix: `Add "publishConfig": { "access": "public" } to ${pkgJsonPath}`
    });
  }
  children.push(
    {
      name: "published to npm",
      check: () => isPublishedToNpm(displayName),
      fix: `Run "npm publish --access public" from ${workspace.dir} to bootstrap the package on npm`,
      checks: [
        {
          name: "trusted publisher configured",
          check: () => hasTrustedPublisher(displayName, getCachedOwnerRepo(), PUBLISH_WORKFLOW_FILE),
          get fix() {
            return `Run: npm trust github ${displayName} --repo ${getCachedOwnerRepo()} --file ${PUBLISH_WORKFLOW_FILE}`;
          }
        }
      ]
    },
    {
      name: "files field exists",
      severity: "warn",
      check: () => workspace.packageJson.files !== void 0,
      fix: `Add a "files" field to ${pkgJsonPath} to control which files are included in the published tarball`
    }
  );
  return {
    name: displayName,
    skip: () => skipIfNotPublishable(workspace),
    check: () => true,
    checks: children
  };
}
function checkProvenanceMatchesVisibility() {
  const workflowPath = ".github/workflows/publish.yaml";
  const content = readFile(workflowPath);
  if (content === void 0) {
    return { ok: false, detail: `Cannot read ${workflowPath} \u2014 check file permissions` };
  }
  const hasProvenance = parseProvenanceSetting(content);
  let isPrivate;
  try {
    isPrivate = isRepoPrivate();
  } catch {
    return { ok: false, detail: "Install and authenticate the GitHub CLI: gh auth login" };
  }
  if (!isPrivate && !hasProvenance) {
    return {
      ok: false,
      detail: "Set provenance: true in .github/workflows/publish.yaml \u2014 public repos should generate provenance attestations"
    };
  }
  if (isPrivate && hasProvenance) {
    return {
      ok: false,
      detail: "Make the GitHub repo public \u2014 OIDC publishing with provenance requires a public repo"
    };
  }
  return { ok: true };
}
function getOwnerRepo() {
  const url = execSync("git remote get-url origin", {
    encoding: "utf8"
  }).trim();
  const sshMatch = url.match(/git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch?.[1]) {
    return sshMatch[1];
  }
  const httpsMatch = url.match(/github\.com\/(.+?)(?:\.git)?$/);
  if (httpsMatch?.[1]) {
    return httpsMatch[1];
  }
  throw new Error(`Cannot parse GitHub owner/repo from remote URL: ${url}`);
}
function hasTokenReferences() {
  const workflowDir = path.resolve(process.cwd(), ".github/workflows");
  if (!existsSync(workflowDir)) {
    return false;
  }
  const files = readdirSync(workflowDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  for (const file of files) {
    const content = readFileSync(path.join(workflowDir, file), "utf8");
    if (content.includes("NPM_TOKEN") || content.includes("NODE_AUTH_TOKEN")) {
      return true;
    }
  }
  return false;
}
function hasTrustedPublisher(packageName, expectedRepo, expectedFile) {
  let output;
  try {
    output = execSync(`npm trust list ${packageName} --json`, {
      encoding: "utf8",
      stdio: "pipe"
    });
  } catch {
    return false;
  }
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    return false;
  }
  if (!isRecord(parsed)) {
    return false;
  }
  return parsed.type === "github" && parsed.repository === expectedRepo && parsed.file === expectedFile;
}
function isPublishedToNpm(packageName) {
  try {
    execSync(`npm view ${packageName} version`, {
      encoding: "utf8",
      stdio: "pipe"
    });
    return true;
  } catch {
    return false;
  }
}
function isRepoPrivate() {
  const ownerRepo = getOwnerRepo();
  const result = execSync(`gh api repos/${ownerRepo} --jq .private`, {
    encoding: "utf8"
  }).trim();
  return result === "true";
}
function parseProvenanceSetting(workflowContent) {
  return /^[^#]*provenance:\s*['"]?true['"]?/im.test(workflowContent);
}
export {
  buildWorkspaceCheck,
  npm_auto_publish_default as default,
  skipIfNotPublishable
};
