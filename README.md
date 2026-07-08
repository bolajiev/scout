# Scout — On-Device Football AI

**Football chat and match prediction, powered by the QVAC SDK**

Scout is a football AI app for Android. All *AI inference* — chat and match-prediction reasoning — runs **100% on-device through the [QVAC SDK](https://qvac.tether.io)**: no AI cloud, no LLM API keys, no account, and nothing you type or ask ever leaves the phone for the model to answer it. Separately, Scout also pulls in real football data (fixtures, live scores, team form, and genuine ML match-result probabilities) from a small set of sports-data APIs over the network — those calls send team/match names to third-party services, and one of them ships with a default API key baked in so the app works without any setup; see [Live data](#live-data) for exactly what goes out and when.

Vision (pointing the camera at a jersey/badge/scoreboard) shipped in an earlier build as a standalone "Scout Lens" screen; it's been pulled out of the tab bar while it's redesigned as an in-Coach camera upgrade instead. The vision models are still downloadable from the Models screen, but no screen currently uses them.

---

## Features

| Feature | Engine | What it does |
|---|---|---|
| **AI Coach** | QVAC LLM | Football chat with live tool calling — the model decides when to fetch today's fixtures, a team's recent results (Bzzoiro Sports, falling back to football-data.org or TheSportsDB), or football news to verify a claim/rumor (BBC Sport, Sky Sports, The Guardian RSS), and grounds its answers in real data. Every fetch is disclosed with a tappable chip showing the raw data used. Streams tokens live; in Think mode the reasoning stream shows too, then collapses to a tappable "Thought for X.Xs" row. Answers render as markdown. A small status pill shows whether the on-device model is loaded, loading, or needs attention, with a one-tap Stop. |
| **Predictor** | QVAC LLM + Bzzoiro ML | Pick a fixture (World Cup 2026 and top-5-league matches with real team badges) or type any two teams. Recent form (last 5 real results) is fetched live and injected into the prompt; the model commits to a winner, score, confidence, and analysis. When the match resolves to a known Bzzoiro event, the result page's win-probability odds are the sports-data API's actual CatBoost model output, not a number derived from the LLM's own confidence wording — the UI labels which one you're looking at. |
| **History** | SQLite | Every Coach conversation and Predictor call stored locally and replayable. |

---

## QVAC SDK Integration

Scout uses `@qvac/sdk` v0.13.5 for all inference — `loadModel`, `completion`, `cancel`.

### AI Coach — streaming, thinking, and tool calling

Two-pass loop: pass 1 may emit tool calls; results are appended as `tool` messages; pass 2 streams the grounded answer.

```ts
const run1 = completion({
  modelId,
  history: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
  stream: true,
  tools: SCOUT_TOOLS,      // get_today_fixtures, get_team_form, get_football_news
  captureThinking: thinkMode,
  generationParams: { ...genParams, reasoning_budget: thinkMode ? -1 : 0 },
});

for await (const event of run1.events) {
  if (event.type === 'thinkingDelta') thought += event.text;   // streamed live
  else if (event.type === 'contentDelta') answer += event.text;
}

const toolCalls = await run1.toolCalls;
// execute against Bzzoiro/football-data.org/TheSportsDB (fixtures/form) or
// football RSS feeds (news), push { role: 'tool', content } messages, then
// run pass 2 for the final grounded answer — the raw tool result is also
// kept for the UI so the user can see exactly what data backed the answer
```

Streaming UI flushes are throttled to ~40ms batches, finished answers render as markdown while the live stream stays plain text, and completed bubbles are memoized — tokens never lag behind the model, even in long chats.

### Predictor — structured output with live form, plus a real ML cross-check

Real recent results (last 5 games per team, Bzzoiro-first with football-data.org/TheSportsDB fallback) are fetched live and injected as `[LIVE FORM DATA]`; the system prompt constrains the model's own output to a parseable format:

```
WINNER: Manchester City
SCORE: 2-1
CONFIDENCE: High
---
City's high press and recent 4-0 run give them the edge...
```

Predictor always runs the model with `reasoning_budget: 0` — there's no Think-mode toggle here, every call commits directly to a verdict. In parallel with that on-device call (never adding wait time), Scout also tries to resolve the exact fixture against Bzzoiro Sports and fetch its real win-probability output; if found, the result page shows those actual numbers instead of a split derived from the LLM's own confidence wording, and says so.

### Vision (not currently wired into any screen)

The vision models (Gemma 4 2B + mmproj, SmolVLM2) remain downloadable and `llmManager.ensure()` still accepts a `projectionModelSrc` for multimodal loading — the plumbing from the old Scout Lens screen — but no current screen calls it. The plan is a camera icon in Coach's composer rather than a separate tab.

### Model lifecycle

One model resident at a time (`llmManager`): screens share the loaded model, a different model unloads the previous one first, the app auto-releases after 30s in background, and the process is killed on app close so native memory never lingers.

### Custom worker bundle (APK size: ~918 MB of native libs → ~145 MB)

The stock QVAC setup ships every inference engine (LLM, embeddings, Whisper, ffmpeg). Scout regenerates the worker with **only the llama.cpp completion plugin** (`qvac.config.json` → `bundleSdk`) and links **only the addons in `qvac/addons.manifest.json`, arm64 only**.

EAS Build reinstalls `node_modules`, which would silently revert these patches — so `scripts/postinstall.mjs` re-applies them after every install:

1. `qvac/bare-link.android.mjs` → `react-native-bare-kit/android/link.mjs` (manifest-aware addon linker)
2. `qvac/worker.bundle.js` → `@qvac/sdk/dist/worker.mobile.bundle.js` (LLM-only worker; the published package does not ship this file)

---

## Live data

Fixtures, scores, and form come from three sources, tried in priority order and merged so the same real match never shows twice:

1. **[Bzzoiro Sports](https://sports.bzzoiro.com)** — the primary source when a key is active. Real fixtures/live scores/minute across 30+ leagues in one bulk call, a genuine CatBoost ML model for match-result probabilities/xG/BTTS (used in Predictor's result page), and the last-5-real-games form data fed into both Coach and Predictor's prompts. Ships with a **default key baked in at build time** (from an untracked `.env`, never committed) so the app works with no setup; a user's own key, pasted in Settings, always overrides it and is stored only in on-device `AsyncStorage`. Team/match names and dates are sent to this API to look matches up — nothing else about the device or user.
2. **[football-data.org](https://www.football-data.org)** — optional, user-supplied key only (no shared default). Falls back to this for the ~12 competitions it covers if Bzzoiro has nothing for that match.
3. **[TheSportsDB](https://www.thesportsdb.com)** — free, keyless, always available. The final fallback for fixtures/team badges, and also how team crests get resolved by name when a fixture's own payload doesn't include one.

Fixtures are cached in SQLite keyed by date — offline you get the last successful fetch, never a stale day. A lightweight connectivity check (a fast ping to a public endpoint, not a data-collection call) is used only to distinguish "no internet at all" from "online but these APIs are slow/down" in the UI copy — it doesn't gate any feature.

[BBC Sport](https://feeds.bbci.co.uk/sport/football/rss.xml), [Sky Sports](https://www.skysports.com/rss/11095), and [The Guardian](https://www.theguardian.com/football/rss) RSS feeds (all public, no key) back the AI Coach's `get_football_news` tool — used only to verify a specific claim, transfer, injury, or club news story, never for tactics/history/opinion questions.

None of the above are AI services — they return data, not model output. The actual chat/prediction reasoning stays on Bzzoiro/football-data.org/TheSportsDB's data as *input*, processed entirely by the on-device QVAC model.

---

## Models

Downloaded in-app (resumable) to app-private storage `DocumentDirectory/scout/models/<id>/`. Partial downloads are detected by size check and never handed to the native loader.

| Model | Type | Size | Used for |
|---|---|---|---|
| Qwen3 0.6B | Text | 390 MB | Instant tier — loads in seconds, full chat/predict on any device |
| Qwen3 1.7B Q4 | Text | 1.1 GB | AI Coach, Predictor — fast, recommended |
| MedPsy 1.7B (QVAC) | Text | 1.1 GB | Lighter-weight alternative |
| MedPsy 4B (QVAC) | Text | 2.7 GB | Richer reasoning |
| SmolVLM2 500M | Vision | 550 MB | Not currently used by any screen — fastest of the two if vision returns |
| Gemma 4 2B Q4 + mmproj | Vision | 3.8 GB | Not currently used by any screen — richer identification if vision returns |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Expo SDK 54, React Native 0.81 (bare workflow, local `android/`) |
| AI inference | QVAC SDK on `react-native-bare-kit` (Bare runtime) |
| Storage | SQLite (`expo-sqlite`) + AsyncStorage |
| Live data | Bzzoiro Sports REST (default key + optional user key), football-data.org REST (optional user key), TheSportsDB REST (free, no key) |
| Language | TypeScript |
| Target | Android arm64-v8a, minSdk 29, NDK 27.1.12297006 + explicit NDK 28b `libc++_shared.so` for QVAC's native engines, new architecture |

---

## Building

```bash
npm install                 # postinstall re-applies QVAC patches automatically

# Optional: EXPO_PUBLIC_BZ_API_KEY=<your key> in a .env file (untracked)
# enables Bzzoiro Sports (real predictions, live scores, top-5-league/World
# Cup chips) by default. Without it, the app still works — it falls back
# to football-data.org (if a user later adds their own key in-app) and
# then the free, keyless TheSportsDB, just without those extras.

npx tsc --noEmit --skipLibCheck

# Local build (no EAS quota needed) — signs with android/app/debug.keystore
# unless KEYSTORE_PATH/KEYSTORE_PASSWORD/KEY_ALIAS/KEY_PASSWORD are set
cd android && ./gradlew assembleRelease
# APK: android/app/build/outputs/apk/release/app-release.apk

# or, via EAS:
eas build --platform android --profile preview   # signed APK, local credentials
```

`.easignore` ships the local `android/` directory (skips server prebuild, keeps the NDK 27 toolchain and manifest fixes) and excludes `android/build/` so stale caches never reach the build server. Running `expo prebuild --clean` regenerates `android/` — re-apply the NDK version (27.1.12297006), the `jniLibs/arm64-v8a/libc++_shared.so` override, and the manifest fixes if you do.

---

## Privacy

- AI inference never leaves the device — no chat message, prediction question, or model output is ever sent anywhere; the QVAC model runs entirely locally
- No analytics, no accounts, no telemetry
- Team/match names and dates are sent to the sports-data APIs above to look up fixtures, form, and (for Predictor) a real match-result probability — that's data lookup, not AI processing, and it's the one category of outbound network traffic beyond model downloads
- API keys (the shared default and any user-supplied one) travel only in request headers, never in a URL, and are never logged
- Clear All Data wipes AsyncStorage and every SQLite table, including any saved API key

AI reasoning stays 100% on-device. Getting *real-world facts* into that reasoning (today's fixtures, a team's actual recent form, a real ML probability) necessarily means asking a data source for them — Scout does that as narrowly as it can and never for the reasoning itself.
