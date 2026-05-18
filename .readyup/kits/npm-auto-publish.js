/** @noformat — @generated. Do not edit. Compiled by rdy. */
/* eslint-disable */
export const __readyupVersion = "0.21.0";


// .readyup/kits/npm-auto-publish.ts
import { execSync } from "node:child_process";
import { existsSync, globSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineRdyChecklist, defineRdyKit, defineRdyStagedChecklist } from "readyup";
import { fileContains, fileExists, getJsonValue, isRecord, readFile, readJsonFile } from "readyup/check-utils";
var PUBLISH_WORKFLOW_FILE = "publish.yaml";
var cachedOwnerRepo;
var cachedPackages;
function getCachedOwnerRepo() {
  if (cachedOwnerRepo === void 0) {
    cachedOwnerRepo = getOwnerRepo();
  }
  return cachedOwnerRepo;
}
function getPackages() {
  if (cachedPackages === void 0) {
    cachedPackages = discoverPackages();
  }
  return cachedPackages;
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
      name: "Node.js >= 22",
      check: () => getNodeMajorVersion() >= 22,
      fix: "Upgrade to Node.js 22 or later"
    },
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
      name: "At least one package discovered",
      check: () => getPackages().length > 0,
      fix: "Ensure pnpm-workspace.yaml lists package globs, or that a root package.json exists"
    }
  ],
  get checks() {
    return getPackages().map((pkg) => buildPackageCheck(pkg));
  }
});
var npm_auto_publish_default = defineRdyKit({
  fixLocation: "inline",
  checklists: [repoChecklist, packagesChecklist]
});
function buildPackageCheck(pkg) {
  const pkgJsonPath = path.join(pkg.relativePath, "package.json");
  const children = [
    {
      name: "repository field exists",
      check: () => pkg.packageJson.repository !== void 0 && pkg.packageJson.repository !== null,
      fix: `Add a "repository" field to ${pkgJsonPath} pointing to the GitHub repo`
    },
    {
      name: "not marked private",
      check: () => pkg.packageJson.private !== true,
      fix: `Remove "private": true from ${pkgJsonPath}, or exclude this package from the publish workflow`
    }
  ];
  if (pkg.name.startsWith("@")) {
    children.push({
      name: 'publishConfig.access is "public"',
      check: () => {
        const access = getJsonValue(pkg.packageJson, "publishConfig", "access");
        return typeof access === "string" && access === "public";
      },
      fix: `Add "publishConfig": { "access": "public" } to ${pkgJsonPath}`
    });
  }
  children.push(
    {
      name: "published to npm",
      check: () => isPublishedToNpm(pkg.name),
      fix: `Run "npm publish --access public" from ${pkg.relativePath} to bootstrap the package on npm`,
      checks: [
        {
          name: "trusted publisher configured",
          check: () => hasTrustedPublisher(pkg.name, getCachedOwnerRepo(), PUBLISH_WORKFLOW_FILE),
          get fix() {
            return `Run: npm trust github ${pkg.name} --repo ${getCachedOwnerRepo()} --file ${PUBLISH_WORKFLOW_FILE}`;
          }
        }
      ]
    },
    {
      name: "files field exists",
      severity: "warn",
      check: () => pkg.packageJson.files !== void 0,
      fix: `Add a "files" field to ${pkgJsonPath} to control which files are included in the published tarball`
    }
  );
  return {
    name: pkg.name,
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
function discoverPackages() {
  if (fileExists("pnpm-workspace.yaml")) {
    return discoverWorkspacePackages(path.resolve(process.cwd(), "pnpm-workspace.yaml"));
  }
  const rootPkg = readJsonFile("package.json");
  if (rootPkg === void 0) {
    return [];
  }
  return [
    {
      name: getPackageName(rootPkg),
      dir: process.cwd(),
      relativePath: ".",
      packageJson: rootPkg
    }
  ];
}
function discoverWorkspacePackages(workspaceConfigPath) {
  const content = readFileSync(workspaceConfigPath, "utf8");
  const globs = parseWorkspaceGlobs(content);
  const results = [];
  for (const pattern of globs) {
    const dirs = globSync(pattern, { cwd: process.cwd() });
    for (const dir of dirs) {
      const pkgJsonPath = path.join(dir, "package.json");
      const pkgJson = readJsonFile(pkgJsonPath);
      if (pkgJson === void 0) {
        continue;
      }
      results.push({
        name: getPackageName(pkgJson),
        dir: path.resolve(process.cwd(), dir),
        relativePath: dir,
        packageJson: pkgJson
      });
    }
  }
  return results;
}
function getNodeMajorVersion() {
  return Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
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
function getPackageName(packageJson) {
  return typeof packageJson.name === "string" ? packageJson.name : "(unnamed)";
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
function parseWorkspaceGlobs(content) {
  const globs = [];
  let inPackages = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "packages:") {
      inPackages = true;
      continue;
    }
    if (inPackages && trimmed !== "" && !trimmed.startsWith("-") && !trimmed.startsWith("#")) {
      break;
    }
    if (inPackages && trimmed.startsWith("-")) {
      const glob = trimmed.replace(/^-\s*/, "").replace(/^['"]|['"]$/g, "");
      if (glob) {
        globs.push(glob);
      }
    }
  }
  return globs;
}
export {
  npm_auto_publish_default as default
};
