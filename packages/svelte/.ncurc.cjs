module.exports = {
  filterResults,
};

/**
 * @typedef {Object} SemVer
 * @property {string} semver
 * @property {string} major
 * @property {string} minor
 * @property {string} patch
 */

/**
 * @typedef {Object} VersioningMetadata
 * @property {string} currentVersion
 * @property {SemVer[]} currentVersionSemver
 * @property {string} upgradedVersion
 * @property {SemVer} upgradedVersionSemver
 */

/**
 * Returns true if the upgraded version of the package should be included in available upgrades.
 *
 * @param {string} packageName
 * @param {VersioningMetadata} versioningMetadata
 * @returns {boolean} - true if the package should be included
 */
function filterResults(packageName, versioningMetadata) {
  // Don't upgrade any versions of Vite > 6
  if (packageName === 'vite' && Number.parseInt(versioningMetadata.upgradedVersionSemver.major) > 6) {
    return false;
  }

  return true;
}
