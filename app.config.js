const { execSync } = require('child_process');
const appJson = require('./app.json');

// A commit-derived build ID so a beta tester can tell Claude/us exactly
// which build they're on. buildNumber is commit count (git rev-list
// --count) — a plain incrementing integer with zero manual bookkeeping,
// easy to compare ("are you on a newer build than me?") — buildHash is
// the short SHA for exact traceability when it matters. Computed at
// Metro bundle time (every gradlew assembleRelease bundles fresh), so it
// always reflects the commit actually being built.
function run(cmd) {
  try {
    return execSync(cmd, { cwd: __dirname }).toString().trim();
  } catch {
    return null;
  }
}

module.exports = {
  ...appJson,
  expo: {
    ...appJson.expo,
    extra: {
      ...appJson.expo.extra,
      buildNumber: run('git rev-list --count HEAD') ?? '0',
      buildHash: run('git rev-parse --short HEAD') ?? 'unknown',
      buildDate: new Date().toISOString().slice(0, 10),
    },
  },
};
