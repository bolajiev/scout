import {
  QWEN3_1_7B_INST_Q4,
  GEMMA4_2B_MULTIMODAL_Q4_K_M,
  MMPROJ_GEMMA4_2B_MULTIMODAL_Q8_0,
} from '@qvac/sdk';

const MEDPSY_4B_SRC = 'registry://hf/qvac/MedPsy-4B-GGUF/resolve/main/medpsy-4b-q4_k_m-imat.gguf';
const MEDPSY_1_7B_SRC = 'registry://hf/qvac/MedPsy-1.7B-GGUF/resolve/main/medpsy-1.7b-q4_k_m-imat.gguf';
import { ModelInfo } from '../types';

export const MODEL_KEYS = {
  TEXT_FAST: 'text-fast',
  TEXT_HEALTH: 'text-health',
  TEXT_HEALTH_LITE: 'text-health-lite',
  VISION: 'vision',
} as const;

export type ModelKey = (typeof MODEL_KEYS)[keyof typeof MODEL_KEYS];

export const AVAILABLE_MODELS: ModelInfo[] = [
  {
    id: MODEL_KEYS.TEXT_FAST,
    name: 'Qwen3 1.7B',
    modelType: 'text',
    tagline: 'Fast football AI — recommended.',
    description: 'Qwen3 1.7B runs fully on-device. Fast responses, low RAM. Best for AI Coach and Predictor. Start here.',
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
    tagline: 'Google vision model — Scout Lens.',
    description: 'Gemma 4 E2B by Google. Native vision support built into the architecture — identifies jerseys, club badges, and scoreboards for Scout Lens. Also strong for text analysis. Requires ~4 GB free RAM.',
    size: '3.8 GB',
    sizeBytes: 3_462_678_272 + 557_367_776,
    modelSrc: GEMMA4_2B_MULTIMODAL_Q4_K_M.src,
    projectionModelSrc: MMPROJ_GEMMA4_2B_MULTIMODAL_Q8_0.src,
    supports: ['vision', 'text'],
    heavy: true,
  },
];

export function isTextModel(m: ModelInfo): boolean {
  return m.modelType === 'text';
}

export function isVisionModel(m: ModelInfo): boolean {
  return m.modelType === 'vision';
}

export function getModelByKey(key: string): ModelInfo | undefined {
  return AVAILABLE_MODELS.find(m => m.id === key);
}

const HF_REGEX = /registry:\/\/hf\/([^/]+\/[^/]+)\/(resolve|blob)\/([^/]+)\/(.+)/;

export function getHfDownloadUrl(modelSrc: string): string {
  const match = modelSrc.match(HF_REGEX);
  if (match) {
    return `https://huggingface.co/${match[1]}/resolve/${match[3]}/${match[4]}`;
  }
  return modelSrc;
}

