# Scout — On-Device Football AI

**Tether Developers Cup 2026 · QVAC track**

Scout is a fully private football AI app for Android. Every AI feature — chat, match prediction, image recognition — runs **100% on-device through the [QVAC SDK](https://qvac.tether.io)**. No cloud AI, no API keys, no account. The only network traffic is live fixture data from TheSportsDB (free, keyless) and one-time model downloads from Hugging Face.

---

## Features

| Feature | Engine | What it does |
|---|---|---|
| **AI Coach** | QVAC LLM | Football chat with live tool calling — the model decides when to fetch today's fixtures or a team's recent results from TheSportsDB and grounds its answers in real data. Streams tokens live; in Deep mode the thinking process streams too, then collapses to a tappable "Thought for X.Xs" row. Answers render as markdown. |
| **Predictor** | QVAC LLM | Pick a fixture (live World Cup 2026 matches with real team badges) or type any two teams. Recent form is fetched live and injected into the prompt; output is a structured scoreboard: winner, score, confidence, analysis. |
| **Scout Lens** | QVAC Vision | Point the camera at a jersey, club badge, or scoreboard — the vision model identifies it on-device. Reasoning is disabled for scans so results come fast. |
| **History** | SQLite | Every session (chat, prediction, scan) stored locally and replayable. |

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
  tools: SCOUT_TOOLS,                       // get_today_fixtures, get_team_form
  captureThinking: deepMode,
  generationParams: { ...genParams, reasoning_budget: deepMode ? -1 : 0 },
});

for await (const event of run1.events) {
  if (event.type === 'thinkingDelta') thought += event.text;   // streamed live
  else if (event.type === 'contentDelta') answer += event.text;
}

const toolCalls = await run1.toolCalls;
// execute tools against TheSportsDB, push { role: 'tool', content } messages,
// then run pass 2 for the final grounded answer
```

Streaming UI flushes are throttled to ~40ms batches, finished answers render as markdown while the live stream stays plain text, and completed bubbles are memoized — tokens never lag behind the model, even in long chats.

### Predictor — structured output with live form

Real recent results are fetched from TheSportsDB and injected as `[LIVE FORM DATA]`; the system prompt constrains output to a parseable format:

```
WINNER: Manchester City
SCORE: 2-1
CONFIDENCE: High
---
City's high press and recent 4-0 run give them the edge...
```

In Deep mode the thinking stream renders in an amber "Reading the game..." card before the prediction appears.

### Scout Lens — vision with multimodal projection

```ts
const modelId = await llmManager.ensure(visionModel, {
  ctx_size: 2048,
  device: 'auto',
  projectionModelSrc: visionModel.projectionModelSrc,   // mmproj
});

const run = completion({
  modelId,
  history: [
    { role: 'system', content: VISION_PROMPT },
    {
      role: 'user',
      content: 'What football content do you see?',
      attachments: [{ path: bareFilePath }],   // bare path, not file:// URI
    },
  ],
  stream: true,
  generationParams: { predict: 200, reasoning_budget: 0 },
});
```

### Model lifecycle

One model resident at a time (`llmManager`): screens share the loaded model, a different model unloads the previous one first, the app auto-releases after 30s in background, and the process is killed on app close so native memory never lingers.

### Custom worker bundle (APK size: ~918 MB of native libs → ~145 MB)

The stock QVAC setup ships every inference engine (LLM, embeddings, Whisper, ffmpeg). Scout regenerates the worker with **only the llama.cpp completion plugin** (`qvac.config.json` → `bundleSdk`) and links **only the addons in `qvac/addons.manifest.json`, arm64 only**.

EAS Build reinstalls `node_modules`, which would silently revert these patches — so `scripts/postinstall.mjs` re-applies them after every install:

1. `qvac/bare-link.android.mjs` → `react-native-bare-kit/android/link.mjs` (manifest-aware addon linker)
2. `qvac/worker.bundle.js` → `@qvac/sdk/dist/worker.mobile.bundle.js` (LLM-only worker; the published package does not ship this file)

---

## Live data

[TheSportsDB](https://www.thesportsdb.com) free endpoints, no key: today's fixtures, FIFA World Cup 2026 schedule, team search, recent results, and team badge images. Fixtures are cached in SQLite keyed by date — offline you get today's cache, never a stale day. The home card refreshes every 5 minutes, shows live scores, and rotates finished matches to the next kick-off.

---

## Models

Downloaded in-app (resumable) to app-private storage `DocumentDirectory/scout/models/<id>/`. Partial downloads are detected by size check and never handed to the native loader.

| Model | Type | Size | Used for |
|---|---|---|---|
| Qwen3 1.7B Q4 | Text | 1.1 GB | AI Coach, Predictor — fast, recommended |
| MedPsy 1.7B (QVAC) | Text | 1.1 GB | Lighter-weight alternative |
| MedPsy 4B (QVAC) | Text | 2.7 GB | Richer reasoning |
| Gemma 4 E2B Q4 + mmproj | Vision | 3.8 GB | Scout Lens |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Expo SDK 54, React Native 0.81 (bare workflow, local `android/`) |
| AI inference | QVAC SDK on `react-native-bare-kit` (Bare runtime) |
| Storage | SQLite (`expo-sqlite`) + AsyncStorage |
| Live data | TheSportsDB REST (free, no key) |
| Language | TypeScript |
| Target | Android arm64-v8a, minSdk 29, NDK 27, new architecture |

---

## Building

```bash
npm install                 # postinstall re-applies QVAC patches automatically
npx tsc --noEmit --skipLibCheck
eas build --platform android --profile preview   # signed APK, local credentials
```

`.easignore` ships the local `android/` directory (skips server prebuild, keeps NDK 27 and manifest fixes) and excludes `android/build/` so stale caches never reach the build server. Running `expo prebuild --clean` regenerates `android/` — re-apply the NDK version and manifest fixes if you do.

---

## Privacy

- AI inference never leaves the device — no data sent to any AI cloud
- No analytics, no accounts, no telemetry
- Camera/gallery images are processed in memory, on-device only
- Clear All Data wipes AsyncStorage and every SQLite table

Built for the **Tether Developers Cup 2026** — QVAC track.
