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
const src = path.join(root, 'qvac', 'bare-link.android.mjs');
const dst = path.join(root, 'node_modules', 'react-native-bare-kit', 'android', 'link.mjs');

if (fs.existsSync(src) && fs.existsSync(path.dirname(dst))) {
  fs.copyFileSync(src, dst);
  console.log('[postinstall] Applied manifest-aware bare-kit link.mjs');
} else {
  console.warn('[postinstall] Skipped bare-kit link.mjs patch (missing src or target)');
}
