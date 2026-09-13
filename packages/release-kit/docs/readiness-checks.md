# Readiness checks

What release-kit's two readyup kits check, how to run each, and what `npm-auto-publish` needs from the npm session.

release-kit publishes two [readyup](https://www.npmjs.com/package/readyup) kits that check a consuming repo against the release it has installed: the `default` kit covers release-kit's own setup — workflows matching the current templates, config free of removed fields, sync-labels wiring — and `npm-auto-publish` covers a repo's OIDC-based npm publishing setup. Both ship inside the package, so they check against the version you installed rather than whatever a repository ref happens to point at, and a check added in a release reaches your repo on upgrade.

The [README](../README.md#readiness-checks) shows how to name release-kit in the readyup config.

```bash
rdy run --packages                                               # every kit each listed package publishes
rdy run --from npm:@williamthorsen/release-kit                   # the default kit alone
rdy run --from npm:@williamthorsen/release-kit npm-auto-publish  # the npm-auto-publish kit
rdy list --from npm:@williamthorsen/release-kit                  # what release-kit publishes
```

`--packages` is the form that survives release-kit publishing further kits.

`npm-auto-publish` queries the npm registry for each package's trusted publisher, so it needs an npm session elevated by two-factor authentication, and is meant to be invoked deliberately rather than swept up by an unattended run. A session that cannot answer those queries, whether it is missing a login, missing the elevation, or facing an unreachable registry, is reported once by the `npm session can answer trust queries` gate. The rows that would repeat the failed query then stand down: the trusted-publisher rows in every case, and `published to npm` where the registry itself is unreachable. Each package's `package.json` checks report throughout, since they read no registry.
