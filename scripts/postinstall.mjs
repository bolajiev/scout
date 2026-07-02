// Re-apply QVAC patches that live inside node_modules and are lost on npm ci.
//
// react-native-bare-kit's stock android/link.mjs links EVERY installed bare
// addon into the APK (~400MB of native libs). The QVAC expo plugin normally
// replaces it during `expo prebuild` with a manifest-aware version that only
// links the addons listed in qvac/addons.manifest.json — but EAS skips
// prebuild (we ship a local android/ directory), so without this hook every
// cloud build silently reverts to link-everything.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const patches = [
  {
    name: 'manifest-aware bare-kit link.mjs',
    src: path.join(root, 'qvac', 'bare-link.android.mjs'),
    dst: path.join(root, 'node_modules', 'react-native-bare-kit', 'android', 'link.mjs'),
  },
  {
    // The RN client does require('@qvac/sdk/worker.mobile.bundle') which the
    // exports map points at dist/worker.mobile.bundle.js — a file the
    // published package does NOT ship. Prebuild normally copies our generated
    // bundle there; EAS skips prebuild, so without this the worker bundle is
    // missing/stale in cloud builds.
    name: 'QVAC worker.mobile.bundle (LLM-only)',
    src: path.join(root, 'qvac', 'worker.bundle.js'),
    dst: path.join(root, 'node_modules', '@qvac', 'sdk', 'dist', 'worker.mobile.bundle.js'),
  },
];

for (const { name, src, dst } of patches) {
  if (fs.existsSync(src) && fs.existsSync(path.dirname(dst))) {
    fs.copyFileSync(src, dst);
    console.log(`[postinstall] Applied ${name}`);
  } else {
    console.warn(`[postinstall] Skipped ${name} (missing src or target)`);
  }
}
