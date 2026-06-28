# Scout — On-Device Football AI

**Tether Developers Cup 2026** · QVAC primary track + Pears secondary track

Scout is a fully private football AI app that runs entirely on your Android device. No cloud, no API keys, no account required. AI inference runs via the QVAC SDK; fan-to-fan messaging runs via Pears (Holepunch).

---

## Modules

| Module | Track | What it does |
|---|---|---|
| **AI Coach** | QVAC SDK | Stream football Q&A on-device — tactics, players, clubs, tournaments |
| **Predictor** | QVAC SDK | Pick two teams, get a structured match prediction with score, winner, confidence |
| **Scout Lens** | QVAC Vision | Identify player jerseys, club badges, match scoreboards from a photo — on-device |
| **Fan Room** | Pears P2P | Device-to-device fan chat in the stadium — no server, no internet, no account |

---

## QVAC SDK Integration

Scout uses `@qvac/sdk` v0.13.5 for all on-device inference.

### AI Coach — streaming completion

```ts
import { completion, cancel } from '@qvac/sdk';

const run = completion({
  modelId,
  history: [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: 'How does a high press work?' },
  ],
  stream: true,
  captureThinking: false,
  generationParams: {
    predict: 1024,
    temp: 0.7,
    reasoning_budget: 0 as 0,  // disables chain-of-thought
  },
});

for await (const event of run.events) {
  if (event.type === 'contentDelta') {
    streamed += event.text;
    setAnswer(streamed);
  }
}

const stats = await run.stats;
// stats.generatedTokens, stats.tokensPerSecond
```

### Predictor — structured output

The system prompt forces `WINNER / SCORE / CONFIDENCE / ---` output so the result can be parsed into a visual scoreboard:

```
WINNER: Manchester City
SCORE: 2-1
CONFIDENCE: High
---
City's high press and De Bruyne's creativity give them the edge...
```

### Scout Lens — vision model

```ts
const run = completion({
  modelId,   // SmolVLM2 500M or Qwen3-VL 2B
  history: [
    { role: 'system', content: VISION_PROMPT },
    {
      role: 'user',
      content: 'What football content do you see in this image?',
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

// Scan device for downloaded models
const models = await syncModelsFromDisk();

// Load model and keep it hot — returns modelId for completion()
const modelId = await llmManager.ensure(model, { ctx_size: 4096, device: 'auto' });
```

---

## Pears P2P — Fan Room

Fan Room uses [Holepunch](https://holepunch.to) (Pears runtime) for device-to-device messaging. No server, no relay, no account. Works on LAN and in the stadium where internet may be unreliable.

Architecture:
- Each Fan Room generates a unique **room key** (6-char base36 code)
- Room members share the key manually (shown on screen)
- Hyperswarm discovers peers using the key as a topic hash
- Messages are sent directly device-to-device over Pears encrypted channel

Current status: UI is fully built. Pears runtime wiring in progress.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Expo SDK 54, React Native (bare workflow) |
| AI inference | QVAC SDK (`@qvac/sdk` v0.13.5) |
| P2P networking | Pears / Holepunch |
| Language | TypeScript |
| Target | Android (arm64) |

## Models

| Model | Type | Size | Used for |
|---|---|---|---|
| Qwen3 1.7B | Text | 1.1 GB | AI Coach, Predictor (recommended) |
| MedPsy 1.7B | Text | 1.1 GB | AI Coach, Predictor (low-RAM) |
| MedPsy 4B | Text | 2.7 GB | AI Coach, Predictor (richer) |
| SmolVLM2 500M | Vision | 521 MB | Scout Lens |
| Qwen3-VL 2B | Vision | 1.7 GB | Scout Lens (sharper) |

All models are downloaded once, stored locally, and run fully offline.

---

## Building

```bash
npm install
npx tsc --noEmit --skipLibCheck
eas build --platform android --profile preview
```

## Privacy

- No data leaves the device
- No account, no signup, no telemetry
- AI inference: fully local via QVAC SDK
- Fan Room: peer-to-peer via Pears, no server

---

Built for the **Tether Developers Cup 2026** — QVAC track + Pears track.
