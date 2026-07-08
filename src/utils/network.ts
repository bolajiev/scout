// No NetInfo dependency needed for this — a quick fetch against a tiny,
// highly-available endpoint (the same technique Android's own OS uses
// internally for its captive-portal check) is enough to tell "genuinely no
// internet" apart from "the device is online but our data sources are
// slow or down", which needs two different user-facing messages.
export async function isOnline(timeoutMs = 2500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await fetch('https://www.gstatic.com/generate_204', { signal: controller.signal });
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}
