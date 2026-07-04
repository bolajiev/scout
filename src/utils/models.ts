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
    badge: 'RECOMMENDED',
    badgeColor: '#22c55e',
    modelType: 'text',
    tagline: 'Instant — loads in seconds, answers fast.',
    description: 'The speed pick: loads in seconds and streams several times faster than bigger models. Best first download — instant chat and predictions on any device.',
    size: '390 MB',
    sizeBytes: 382_156_480,
    modelSrc: QWEN3_600M_INST_Q4.src,
    supports: ['text'],
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
    description: 'Gemma 4 E2B by Google. Multimodal: powers Scout Lens (jerseys, badges, scoreboards) AND works for AI Coach and Predictor. One model for everything. Requires ~4 GB free RAM.',
    size: '3.8 GB',
    sizeBytes: 3_462_678_272 + 557_367_776,
    mmprojBytes: 557_367_776,
    modelSrc: GEMMA4_2B_MULTIMODAL_Q4_K_M.src,
    projectionModelSrc: MMPROJ_GEMMA4_2B_MULTIMODAL_Q8_0.src,
    supports: ['vision', 'text'],
    heavy: true,
  },
  {
    id: MODEL_KEYS.VISION_LITE,
    name: 'SmolVLM2 500M',
    badge: 'INSTANT',
    badgeColor: '#f59e0b',
    modelType: 'vision',
    tagline: 'Light vision — fast scans, low RAM.',
    description: 'SmolVLM2 500M is the light vision option for Scout Lens: loads in seconds and scans fast on any device. Less detailed than Gemma 4 but great for quick jersey and badge checks.',
    size: '550 MB',
    sizeBytes: 436_808_704 + 108_785_184,
    mmprojBytes: 108_785_184,
    modelSrc: SMOLVLM2_500M_MULTIMODAL_Q8_0.src,
    projectionModelSrc: MMPROJ_SMOLVLM2_500M_MULTIMODAL_Q8_0.src,
    supports: ['vision'],
  },
];

// Best model for text screens (AI Coach, Predictor):
// 1. the user's chosen default (set in Models) when it's downloaded
// 2. any dedicated text model
// 3. a multimodal model like Gemma 4 that also handles text
export function pickTextCapable<T extends ModelInfo>(models: T[], preferredId?: string | null): T | undefined {
  if (preferredId) {
    const pref = models.find(m => m.id === preferredId && m.supports?.includes('text'));
    if (pref) return pref;
  }
  return models.find(m => m.modelType === 'text')
    ?? models.find(m => m.supports?.includes('text'));
}

const HF_REGEX = /registry:\/\/hf\/([^/]+\/[^/]+)\/(resolve|blob)\/([^/]+)\/(.+)/;

export function getHfDownloadUrl(modelSrc: string): string {
  const match = modelSrc.match(HF_REGEX);
  if (match) {
    return `https://huggingface.co/${match[1]}/resolve/${match[3]}/${match[4]}`;
  }
  return modelSrc;
}

