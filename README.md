# Peek — Private On-Device AI

**Seven AI modules. One phone. No cloud.**

Peek is an Android app powered by the [QVAC SDK](https://www.npmjs.com/package/@qvac/sdk) that runs AI models fully on your device. Your photos, audio, documents, and conversations never leave your phone.

Built for the **[QVAC Unleash Edge AI Hackathon](https://dorahacks.io/hackathon/qvac-unleach-edge-ai-i/tracks)**.

---

## Modules

| Module | What it does |
|--------|-------------|
| **Peek Lens** | Point your camera or pick an image — ask anything about what it sees |
| **Peek Voice** | Record or upload audio → live transcript → AI explanation (MedPsy 1.7B default) |
| **Peek Scribe** | Draft documents, notes, or HTML pages with an on-device writing assistant |
| **Peek Deep** | Load a local file → ask questions about it → fully private on-device RAG |
| **AI Chat** | Conversations with a local LLM — supports inline interactive maps via tool calling |
| **Map Search** | Find any place in the world using Google Maps embed — no GPS required |
| **Peel Fun** | Tic-Tac-Toe against the on-device AI — Easy uses the LLM, Hard uses minimax |

---

## Highlights

- **100% on-device inference** — QVAC SDK handles model loading, streaming, and cancellation natively
- **Private by design** — no telemetry, no accounts, no data ever sent to a server
- **Real tool calling** — AI Chat uses the QVAC SDK `tools` API; asking about a location triggers `show_map` and renders an interactive map inline in the chat bubble
- **MedPsy 1.7B default** — Voice explanation defaults to the MedPsy 1.7B model; other screens are user-choice
- **Map privacy notice** — a caution card appears every time the map screen opens, explaining that search queries go to Google Maps but no GPS data is collected
- **Model management** — download models once, stored in per-model folders; swap models per session
- **Inference audit log** — every inference call logs use case, model name, TTFT, total ms, tokens/sec; exportable as CSV from Settings
- **Voice pipeline** — 8-second chunk transcription with Whisper, cross-chunk context chaining, hallucination filtering, MedPsy explanation
- **Scribe artifacts** — generates Markdown and interactive HTML files viewable in-app
- **Deep RAG** — embeds local files on-device using QVAC's embedding model
- **Token stats** — TTFT and tokens/sec shown after every AI response
- **Android notifications** — stop inference from the notification shade while backgrounded
- **Dark and light theme**, conversation history, configurable generation parameters
- **Welcome screen on update** — version tracking shows onboarding once whenever the app updates

---

## Tech Stack

| Layer | Library |
|-------|---------|
| Framework | React Native, Expo SDK 54 (bare workflow) |
| AI runtime | `@qvac/sdk` v0.13.5 — completion, transcribeStream, tool calling, RAG |
| Camera | expo-camera |
| Audio | expo-av |
| Maps | Google Maps embed via react-native-webview (no API key, no GPS) |
| File system | expo-file-system |
| Document picker | expo-document-picker |
| Persistence | @react-native-async-storage/async-storage |
| Navigation | React Navigation (native stack) |

---

## Models

Models are downloaded on first use and stored on-device. Nothing is bundled in the APK.

| Model | Size | Use |
|-------|------|-----|
| MedPsy 1.7B | ~1 GB | Default for Voice explanation — medical & general AI |
| MedPsy 4B | 2.7 GB | Stronger medical specialist — Scribe, Chat, Deep |
| Qwen3 1.7B | 1.1 GB | Fast general text |
| Gemma 4 2B | 2.7 GB | Strong at code and HTML |
| SmolVLM2 500M | 521 MB | On-device image understanding — Peek Lens |

---

## Remote APIs

Peek is offline-first. The only external calls are:

| Service | When | What is sent |
|---------|------|-------------|
| Google Maps embed | Map Search screen / AI Chat inline map | Search query string only. No GPS, no device ID. |
| EAS / Expo | Build time only | Not used at runtime |

All AI inference runs locally. See `api-calls.json` for the full disclosure.

---

## Getting Started

```bash
npm install
npx expo start          # development
eas build --platform android --profile preview   # APK
```

---

## Project Structure

```
src/
├── components/
│   ├── Icons.tsx
│   ├── MarkdownText.tsx
│   ├── ModelGalleryPicker.tsx  # Bottom sheet model switcher
│   └── ...
├── navigation/
│   └── AppNavigator.tsx        # Root stack, theme context
├── screens/
│   ├── AIChatScreen.tsx        # AI Chat — streaming + show_map tool calling
│   ├── NearbyScreen.tsx        # Map Search — Google Maps embed, privacy notice
│   ├── PeelFunScreen.tsx       # Peel Fun — Tic-Tac-Toe vs on-device AI
│   ├── VoiceScreen.tsx         # Voice — Whisper transcription + MedPsy explanation
│   ├── DeepScreen.tsx          # Deep — file RAG
│   ├── ChatScreen.tsx          # Scribe — writing assistant
│   ├── LensResultScreen.tsx    # Lens — vision inference
│   ├── SettingsScreen.tsx      # Theme, params, CSV export
│   ├── OnboardingScreen.tsx    # 3-slide welcome, shown on first launch + updates
│   └── ...
├── utils/
│   ├── auditLogger.ts          # Inference log — TTFT, tokens/sec, CSV export
│   ├── modelManager.ts         # LLMManager + WhisperManager singletons
│   ├── models.ts               # Model catalogue, system prompts, tool definitions
│   └── storage.ts              # AsyncStorage helpers, version tracking
└── types/
    └── index.ts
```

---

## Privacy

- All AI inference runs on-device via the QVAC native runtime
- No images, audio, text, or results are sent to any server
- Map Search uses Google Maps embed — only the search query text is sent to Google; no GPS or device location is collected
- A privacy notice appears every time the map is opened
- Models are downloaded once and cached on-device
