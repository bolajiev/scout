const { execSync } = require('child_process');
const appJson = require('./app.json');

// A commit-derived build ID so a beta tester can tell Claude/us exactly
// which build they're on, same idea as "Build 12345" on other apps —
// computed at Metro bundle time (every gradlew assembleRelease bundles
// fresh), so it always reflects the commit actually being built.
function getBuildId() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
  } catch {
    return 'unknown';
  }
}

module.exports = {
  ...appJson,
  expo: {
    ...appJson.expo,
    extra: {
      ...appJson.expo.extra,
      buildId: getBuildId(),
      buildDate: new Date().toISOString().slice(0, 10),
    },
  },
};
