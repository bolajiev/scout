# Scout — On-Device Football AI
**Tether Developers Cup 2026 · QVAC track · First submission**

## One-liner
A complete football companion — AI coach chat, accountable match predictions, and a vision scanner — where **every AI feature runs 100% on the user's phone through the QVAC SDK**. No cloud AI, no accounts, works in airplane mode.

## What it does
- **AI Coach** — on-device LLM chat with **live tool calling**: the model itself decides when to fetch today's fixtures or a team's recent form from TheSportsDB and grounds its answers in real data. Deep mode streams the model's full thinking process live, then collapses it Claude-style ("Thought for 4.2s"). Answers render as markdown; conversations are stored locally and resumable.
- **Predictor** — pick a live World Cup fixture (real badges, live scores) or type any two teams. Both teams' real recent form is fetched and injected into the prompt; output is a structured scoreboard: winner, score, confidence, each team's key player, and pundit-style analysis. **Every prediction is recorded and automatically graded against the real result — the app displays its own W/L track record.** The AI is accountable.
- **Scout Lens** — multimodal vision + text: scan a jersey, club badge, or scoreboard with the camera, get an identification, then **ask follow-up questions about the same image** in a conversation. All on-device.
- **Live matchday** — home card with the next/live match and score, self-refreshing; matchday rail with every live match and the next kick-offs.

## Real use of QVAC (the deep part)
- All inference via `@qvac/sdk`: `loadModel` / `completion` / `cancel`, streaming `contentDelta` + `thinkingDelta`, tool calls, vision attachments, reasoning budget control.
- **Custom-built QVAC worker**: we regenerated the worker bundle with only the llama.cpp completion plugin and linked only the native addons the app actually uses, for arm64 only — cutting native libraries from **918 MB to 145 MB** and the APK from ~400 MB to ~170 MB.
- **Small models made genuinely useful**: an "Instant" tier (Qwen3 0.6B text, 390 MB · SmolVLM2 500M vision, 550 MB) loads in seconds and streams fast on mid-range phones — the full chat + predict + scan experience in under 1 GB. Bigger tiers (Qwen3 1.7B, QVAC MedPsy 1.7B/4B, Gemma 4 E2B multimodal) are one tap away, with automatic per-feature model swapping and a user-set default.
- We debugged the native stack to the ELF level: the QVAC engines require LLVM-18+ libc++ exception symbols, so the app deterministically ships the correct `libc++_shared.so` — documented in the repo for other QVAC builders.

## Theme fit
Built for the World Cup 2026 moment: live WC fixtures with country crests, predictions with a public track record fans can argue about, and a scanner for match-day moments (jerseys, badges, scoreboards).

## Outside services and pre-built parts (full disclosure)
- **TheSportsDB** (free, keyless): fixtures, live scores, team form, badges — data only, no AI.
- **football-data.org** (optional, user-supplied free key, can be toggled off in-app): richer fixtures/scores for 12 major competitions; free source is the automatic fallback.
- **Hugging Face**: one-time model downloads (Qwen3, Gemma 4, QVAC MedPsy, SmolVLM2 GGUF builds).
- **Expo SDK 54 / React Native 0.81**, `react-native-bare-kit` (Bare runtime hosting the QVAC worker), `expo-sqlite`, `react-native-markdown-display`, `react-native-svg`.
- **EAS Build** for APK compilation. No analytics, no telemetry, no accounts.

## Privacy
AI inference never leaves the device. Photos are processed in memory on-device. History lives in local SQLite. Clear All Data wipes everything.

## Team
Nation: [YOUR NATION] · Built by Oz (@bolajiev)

## Try it
- APK (Android arm64, ~170 MB): [ARTIFACT LINK]
- Fastest demo path: download **Qwen3 0.6B (Instant, 390 MB)** in Models → chat answers in seconds, fully offline.
- Repo: https://github.com/bolajiev/scout
