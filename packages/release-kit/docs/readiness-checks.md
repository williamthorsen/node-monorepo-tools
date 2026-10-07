# Readiness checks

What release-kit's two readyup kits check, how to run each, and what `npm-auto-publish` needs from the npm session.

release-kit publishes two [readyup](https://www.npmjs.com/package/readyup) kits that check a consuming repo against the release that it has installed: The `default` kit covers release-kit's own setup (workflows matching the current templates, config free of removed fields, sync-labels wiring), and `npm-auto-publish` covers a repo's OIDC-based npm publishing setup. Both are included in the package, so they check against the installed version rather than whatever a repository ref happens to point at, and a check added in a release becomes available to a repo when it upgrades.

The [README](../README.md#readiness-checks) shows how to name release-kit in the readyup config.

```bash
rdy run --sources                                                # every kit each listed package publishes
rdy run --from npm:@williamthorsen/release-kit                   # the default kit alone
rdy run --from npm:@williamthorsen/release-kit npm-auto-publish  # the npm-auto-publish kit
rdy list --from npm:@williamthorsen/release-kit                  # what release-kit publishes
```

`--sources` is the form that keeps working when release-kit publishes further kits.

Because `npm-auto-publish` queries the npm registry for each package's trusted publisher, it needs an npm session elevated by two-factor authentication, and is meant to be invoked deliberately rather than included in an unattended run. A session that cannot answer those queries, whether it is missing a login, missing the elevation, or facing an unreachable registry, is reported once by the `npm session can answer trust queries` gate. The rows that would repeat the failed query are then skipped: the trusted-publisher rows in every case, and `published to npm` when the registry itself is unreachable. Each package's `package.json` checks report throughout, since they don't read a registry.
