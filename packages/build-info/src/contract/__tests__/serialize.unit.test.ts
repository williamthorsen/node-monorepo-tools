import { describe, expect, it } from 'vitest';

import { buildFullBuildInfo, buildMinimalBuildInfo } from '../../test-utils/build-info-fixtures.ts';
import { InvalidBuildInfoError } from '../InvalidBuildInfoError.ts';
import { parseBuildInfo } from '../parse.ts';
import { serializeBuildInfo } from '../serialize.ts';
import type { BuildInfo } from '../types.ts';

describe('serializeBuildInfo', () => {
  it.each<[description: string, info: BuildInfo]>([
    ['every field', buildFullBuildInfo()],
    ['only the required fields', buildMinimalBuildInfo()],
  ])('round-trips a value with %s through parseBuildInfo', (_description, info) => {
    expect(parseBuildInfo(serializeBuildInfo(info))).toStrictEqual(info);
  });

  it('writes JSON indented by two spaces, without a trailing newline', () => {
    const serialized = serializeBuildInfo(buildMinimalBuildInfo());

    expect(serialized).toBe(JSON.stringify(buildMinimalBuildInfo(), null, 2));
  });

  it('writes only the contract keys, in the contract order', () => {
    const { environment, host, buildTime, version, name, schemaVersion } = buildMinimalBuildInfo();
    const reordered = { extra: true, environment, host, buildTime, version, name, schemaVersion };

    expect(serializeBuildInfo(reordered)).toBe(JSON.stringify(buildMinimalBuildInfo(), null, 2));
  });

  it('rejects a value that breaks the contract', () => {
    const invalid = { ...buildMinimalBuildInfo(), host: 'netlify' };

    // @ts-expect-error -- The host is outside the union, as an untyped caller could pass.
    expect(() => serializeBuildInfo(invalid)).toThrow(InvalidBuildInfoError);
  });
});
