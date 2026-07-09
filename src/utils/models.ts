import {
  QWEN3_1_7B_INST_Q4,
  QWEN3_600M_INST_Q4,
  GEMMA4_2B_MULTIMODAL_Q4_K_M,
  MMPROJ_GEMMA4_2B_MULTIMODAL_Q8_0,
  SMOLVLM2_500M_MULTIMODAL_Q8_0,
  MMPROJ_SMOLVLM2_500M_MULTIMODAL_Q8_0,
} from '@qvac/sdk';

const MEDPSY_4B_SRC = 'registry://hf/qvac/MedPsy-4B-GGUF/resolve/main/medpsy-4b-q4_k_m-imat.gguf';
const MEDPSY_1_7B_SRC = 'registry://hf/qvac/MedPsy-1.7B-GGUF/resolve/main/medpsy-1.7b-q4_k_m-imat.gguf';
import { ModelInfo } from '../types';

export const MODEL_KEYS = {
  TEXT_FAST: 'text-fast',
  TEXT_INSTANT: 'text-instant',
  TEXT_HEALTH: 'text-health',
  TEXT_HEALTH_LITE: 'text-health-lite',
  VISION: 'vision',
  VISION_LITE: 'vision-lite',
} as const;

export type ModelKey = (typeof MODEL_KEYS)[keyof typeof MODEL_KEYS];

export const AVAILABLE_MODELS: ModelInfo[] = [
  {
    id: MODEL_KEYS.TEXT_INSTANT,
    name: 'Qwen3 0.6B',
    badge: 'LOW-RAM',
    badgeColor: '#f59e0b',
    modelType: 'text',
    tagline: 'Fastest — loads in seconds.',
    description: 'The speed option: loads in seconds and streams several times faster than bigger models. Great for quick questions and low-RAM devices.',
    size: '390 MB',
    sizeBytes: 382_156_480,
    modelSrc: QWEN3_600M_INST_Q4.src,
    supports: ['text'],
    supportsReasoning: true,
  },
  {
    id: MODEL_KEYS.TEXT_FAST,
    name: 'Qwen3 1.7B',
    badge: 'BALANCED',
    badgeColor: '#3b82f6',
    modelType: 'text',
    tagline: 'Deeper answers, still quick.',
    description: 'Qwen3 1.7B gives richer, more detailed analysis than the Instant model while staying responsive. The sweet spot when you have 1.1 GB to spare.',
    size: '1.1 GB',
    sizeBytes: 1_056_782_912,
    modelSrc: QWEN3_1_7B_INST_Q4.src,
    supports: ['text'],
    supportsReasoning: true,
  },
  {
    id: MODEL_KEYS.TEXT_HEALTH_LITE,
    name: 'MedPsy 1.7B',
    modelType: 'text',
    tagline: 'General AI, lighter weight.',
    description: 'MedPsy 1.7B by QVAC. Lightweight general instruction model. Works for AI Coach and Predictor on lower-RAM devices.',
    size: '1.1 GB',
    sizeBytes: 1_056_000_000,
    modelSrc: MEDPSY_1_7B_SRC,
    supports: ['text', 'health'],
  },
  {
    id: MODEL_KEYS.TEXT_HEALTH,
    name: 'MedPsy 4B',
    modelType: 'text',
    tagline: 'Deeper reasoning, more detail.',
    description: 'MedPsy 4B by QVAC. Stronger general model with richer reasoning. Produces more detailed AI Coach responses and predictions. Needs 3 GB+ free RAM.',
    size: '2.7 GB',
    sizeBytes: 2_720_000_000,
    modelSrc: MEDPSY_4B_SRC,
    supports: ['text', 'health'],
    heavy: true,
  },
  {
    id: MODEL_KEYS.VISION,
    name: 'Gemma 4 2B',
    modelType: 'vision',
    tagline: 'Vision + text — the all-in-one model.',
    description: 'Gemma 4 E2B by Google. Multimodal: powers photo uploads in AI Coach (jerseys, badges, scoreboards) AND works as a regular text model for Coach and Predictor. One model for everything. Requires ~4 GB free RAM.',
    size: '3.8 GB',
    sizeBytes: 3_462_678_272 + 557_367_776,
    mmprojBytes: 557_367_776,
    modelSrc: GEMMA4_2B_MULTIMODAL_Q4_K_M.src,
    projectionModelSrc: MMPROJ_GEMMA4_2B_MULTIMODAL_Q8_0.src,
    supports: ['vision', 'text'],
    // EXPERIMENT: previously denied tools entirely (modelType === 'vision'
    // was excluded) after an earlier finding that Gemma's chat template
    // didn't reliably support QVAC's function-calling format. Since Gemma
    // is the "one model for everything" pick, having zero live-data
    // access in Chat is a bigger practical gap than the tool-call risk —
    // trying it explicitly enabled. Watch for malformed/garbled output
    // when Gemma is loaded and Coach tries a tool call; revert this flag
    // if so.
    supportsTools: true,
    heavy: true,
  },
  {
    id: MODEL_KEYS.VISION_LITE,
    name: 'SmolVLM2 500M',
    badge: 'LOW-RAM',
    badgeColor: '#f59e0b',
    modelType: 'vision',
    tagline: 'Light vision — fast scans, low RAM.',
    description: 'SmolVLM2 500M is the light vision option for photo uploads in AI Coach: loads in seconds and scans fast on any device. Less detailed than Gemma 4 but great for quick jersey and badge checks.',
    size: '550 MB',
    sizeBytes: 436_808_704 + 108_785_184,
    mmprojBytes: 108_785_184,
    modelSrc: SMOLVLM2_500M_MULTIMODAL_Q8_0.src,
    projectionModelSrc: MMPROJ_SMOLVLM2_500M_MULTIMODAL_Q8_0.src,
    supports: ['vision'],
  },
];

// Best model for text screens (AI Coach, Predictor). The app never forces
// a catalog favourite — it respects, in order:
// 1. the model already loaded in memory (never swap under the user)
// 2. the user's chosen default (Set Default in Models)
// 3. any downloaded text model, then a multimodal one (e.g. Gemma 4)
export function pickTextCapable<T extends ModelInfo>(
  models: T[],
  preferredId?: string | null,
  loadedId?: string | null,
): T | undefined {
  if (loadedId) {
    const loaded = models.find(m => m.id === loadedId && m.supports?.includes('text'));
    if (loaded) return loaded;
  }
  if (preferredId) {
    const pref = models.find(m => m.id === preferredId && m.supports?.includes('text'));
    if (pref) return pref;
  }
  // Same bug class as pickVisionCapable below: taking whichever text model
  // came first in AVAILABLE_MODELS had no regard for speed at all — it
  // happened to line up with size order today, but only by accident of
  // how that list is authored. Smallest (fastest) first, explicitly.
  const text = models.filter(m => m.modelType === 'text' || m.supports?.includes('text'));
  text.sort((a, b) => a.sizeBytes - b.sizeBytes);
  return text[0];
}

// Same idea, for the "attach an image in Coach" flow — picks a downloaded
// vision-capable model, preferring one already resident in memory.
export function pickVisionCapable<T extends ModelInfo>(
  models: T[],
  loadedId?: string | null,
): T | undefined {
  if (loadedId) {
    const loaded = models.find(m => m.id === loadedId && m.modelType === 'vision');
    if (loaded) return loaded;
  }
  // BUG FIX: this used to just take whichever vision model came first in
  // AVAILABLE_MODELS — Gemma 4 2B (3.8GB) is listed before SmolVLM2 500M,
  // so if BOTH were downloaded, the auto-switch on attaching a photo
  // always picked the slower, much bigger one with zero regard for
  // speed. Smallest-first, matching the same philosophy already used for
  // the Models screen's own sort order.
  const vision = models.filter(m => m.modelType === 'vision');
  vision.sort((a, b) => a.sizeBytes - b.sizeBytes);
  return vision[0];
}

const HF_REGEX = /registry:\/\/hf\/([^/]+\/[^/]+)\/(resolve|blob)\/([^/]+)\/(.+)/;

export function getHfDownloadUrl(modelSrc: string): string {
  const match = modelSrc.match(HF_REGEX);
  if (match) {
    return `https://huggingface.co/${match[1]}/resolve/${match[3]}/${match[4]}`;
  }
  return modelSrc;
}

