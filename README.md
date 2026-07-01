# Scout — On-Device Football AI

**Tether Developers Cup 2026** · QVAC primary track + Pears secondary track

Scout is a fully private football AI app that runs entirely on your Android device. No cloud, no API keys, no account required. AI inference runs via the QVAC SDK on-device; live match data comes from TheSportsDB (free, no key); fan-to-fan messaging runs via Pears (Holepunch).

---

## Modules

| Module | Track | What it does |
|---|---|---|
| **Match AI** | QVAC SDK | Ask any football question — on-device LLM with tool calling fetches today's live fixtures from TheSportsDB to ground answers in real match data |
| **Predictor** | QVAC SDK | Pick two teams, get a structured prediction: winner, score, confidence, and reasoning — all on-device |
| **Scout Lens** | QVAC Vision | Point your camera at a jersey, badge, or scoreboard — vision model identifies it on-device |
| **History** | SQLite | Browse and replay past Match AI, Predictor, and Scout Lens sessions |

---

## QVAC SDK Integration

Scout uses `@qvac/sdk` v0.13.5 for all on-device inference.

### Match AI — streaming with tool calling

Match AI runs a two-pass inference loop: Pass 1 may call the `get_fixtures` tool to fetch live data; Pass 2 streams the final answer grounded in that data.

```ts
import { completion, cancel } from '@qvac/sdk';
import { SCOUT_TOOLS } from './tools';

// Pass 1 — may call tools
const run1 = completion({
  modelId,
  history: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
  stream: true,
  captureThinking: false,
  tools: SCOUT_TOOLS,
  generationParams: { predict: 1024, temp: 0.7, reasoning_budget: 0 as 0 },
});

for await (const event of run1.events) {
  if (event.type === 'contentDelta') streamed += event.text;
}

const toolCalls = await run1.toolCalls;
// execute tool calls, fetch TheSportsDB data...

// Pass 2 — final answer, no further tool calls
const run2 = completion({
  modelId,
  history: [...toolHistory],
  stream: true,
  captureThinking: false,
  generationParams: { predict: 1024, temp: 0.7, reasoning_budget: 0 as 0 },
});

for await (const event of run2.events) {
  if (event.type === 'contentDelta') answer += event.text;
}
```

### Predictor — structured output

The system prompt constrains the model to output a parseable scoreboard format:

```
WINNER: Manchester City
SCORE: 2-1
CONFIDENCE: High
---
City's high press and De Bruyne's creativity give them the edge...
```

### Scout Lens — vision model with multimodal projection

```ts
// projectionModelSrc (mmproj) must be passed for vision models
const modelId = await llmManager.ensure(visionModel, {
  ctx_size: 2048,
  device: 'auto',
  projectionModelSrc: visionModel.projectionModelSrc,
});

const run = completion({
  modelId,
  history: [
    { role: 'system', content: VISION_PROMPT },
    {
      role: 'user',
      content: 'What football content do you see?',
      attachments: [{ path: imageUri }],
    },
  ],
  stream: true,
  generationParams: { predict: 200, reasoning_budget: 0 as 0 },
});
```

### Model management

```ts
import { llmManager } from './utils/modelManager';
import { syncModelsFromDisk } from './utils/storage';

// Scan device storage for downloaded models
const models = await syncModelsFromDisk();

// Load a model and keep it resident — returns modelId for completion()
// For vision models, always pass projectionModelSrc
const modelId = await llmManager.ensure(model, {
  ctx_size: 4096,
  device: 'auto',
  projectionModelSrc: model.projectionModelSrc,
});
```

Models stay loaded across screens. The app releases the model automatically after 30 seconds in the background (AppState listener in `App.tsx`).

---

## Data & Privacy

- All AI inference runs on-device via QVAC SDK — no data sent to any AI cloud
- Live match data: TheSportsDB free tier (`thesportsdb.com`) — no key, no auth
- SQLite history stored locally in app-private storage
- No account, no signup, no telemetry

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Expo SDK 54, React Native (bare workflow) |
| AI inference | QVAC SDK (`@qvac/sdk` v0.13.5) |
| Storage | SQLite (`expo-sqlite` v16) + AsyncStorage |
| Live data | TheSportsDB REST API (free, no key) |
| Language | TypeScript |
| Target | Android arm64 (minSdk 29) |

---

## Models

| Model | Type | Size | Used for |
|---|---|---|---|
| Qwen3 1.7B | Text | 1.1 GB | Match AI, Predictor — fast, recommended |
| MedPsy 1.7B | Text | 1.1 GB | Match AI, Predictor — lighter weight |
| MedPsy 4B | Text | 2.7 GB | Match AI, Predictor — richer reasoning |
| Gemma 4 2B | Vision | 3.8 GB | Scout Lens — jersey, badge, scoreboard ID |

Models are downloaded once to app-private storage (`DocumentDirectory/scout/models/<id>/`) and run fully offline. The app migrates old folder names automatically on first launch.

---

## Building

```bash
npm install

# Type check
npx tsc --noEmit --skipLibCheck

# EAS build (bare workflow — uses local android/ directory)
eas build --platform android --profile preview
```

The `android/` directory is gitignored but included in the EAS archive via `.easignore`. Running `expo prebuild --clean` regenerates `android/` — after which the NDK version in `android/build.gradle` must match `27.1.12297006` (Expo SDK 54 official).

---

Built for the **Tether Developers Cup 2026** — QVAC primary track.
