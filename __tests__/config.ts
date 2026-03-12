import path from 'node:path';

export const ASDF_VERSION_FILE = '.tool-versions';
export const GITHUB_ACTION_FILE = 'code-quality.yaml';
export const GITHUB_ACTION_FILE_PATH = path.join('.github/workflows', GITHUB_ACTION_FILE);
export const PACKAGE_JSON_FILE = 'package.json';
