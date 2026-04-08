/** Default audit-deps config file content. */
export const auditDepsConfigTemplate =
  JSON.stringify(
    {
      outDir: '../tmp',
      dev: {
        moderate: true,
        allowlist: [],
      },
      prod: {
        high: true,
        allowlist: [],
      },
    },
    null,
    2,
  ) + '\n';
