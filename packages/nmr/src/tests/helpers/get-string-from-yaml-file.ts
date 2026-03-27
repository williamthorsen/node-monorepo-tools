import assert from 'node:assert';
import fs from 'node:fs';

import yaml from 'js-yaml';

import { getValueAtPathOrThrow } from './get-value-at-path.js';

/** Read a YAML file and extract a non-empty string value at the given dot-separated key path. */
export async function getStringFromYamlFile(filePath: string, keyPath: string, label: string): Promise<string> {
  const raw = await fs.promises.readFile(filePath, { encoding: 'utf8' });
  const parsed = yaml.load(raw);
  assert.ok(parsed, `YAML content not found in ${filePath}`);

  const value = getValueAtPathOrThrow(parsed, keyPath);
  assert.ok(typeof value === 'string' && value.length > 0, `${label} not found at ${keyPath}`);

  return value;
}
