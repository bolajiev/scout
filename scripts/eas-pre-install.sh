#!/usr/bin/env bash
# EAS lifecycle hook (eas-build-pre-install): make sure NDK 29.0.14206865 is
# present on the build image. QVAC's prebuilt native engines require NDK 29's
# libc++_shared.so. AGP can auto-provision the NDK, but doing it here makes
# the step explicit in the logs. Never fails the build — AGP is the fallback.
set +e
NDK_VERSION="29.0.14206865"

if [ -d "$ANDROID_HOME/ndk/$NDK_VERSION" ]; then
  echo "[pre-install] NDK $NDK_VERSION already installed"
  exit 0
fi

SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
if [ ! -x "$SDKMANAGER" ]; then
  SDKMANAGER="$(command -v sdkmanager)"
fi

if [ -n "$SDKMANAGER" ] && [ -x "$SDKMANAGER" ]; then
  echo "[pre-install] Installing NDK $NDK_VERSION..."
  yes | "$SDKMANAGER" --licenses >/dev/null 2>&1
  "$SDKMANAGER" "ndk;$NDK_VERSION" >/dev/null && echo "[pre-install] NDK $NDK_VERSION installed"
else
  echo "[pre-install] sdkmanager not found — relying on AGP auto-provision"
fi
exit 0
