export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  tagline?: string;
  badge?: string;
  badgeColor?: string;
  size: string;
  sizeBytes: number;
  modelSrc: string;
  projectionModelSrc?: string;
  modelType: 'vision' | 'text';
  supports: string[];
  isDownloaded?: boolean;
  downloadedPath?: string;
  isCustom?: boolean;
  heavy?: boolean;
}

export interface DownloadedModel extends ModelInfo {
  downloadedPath: string;
  isDownloaded: true;
}

export interface InferenceLog {
  timestamp: string;
  useCase: string;
  modelName: string;
  ttftMs: number;
  totalMs: number;
  tokensPredicted: number;
  tokensPerSec: number;
  deviceModel: string;
  deviceBrand: string;
}

export type ThemeMode = 'dark' | 'light';
export type Accelerator = 'gpu' | 'cpu';
export type ResponseLength = 'short' | 'balanced' | 'detailed';

export interface AppSettings {
  theme: ThemeMode;
  accelerator: Accelerator;
  responseLength: ResponseLength;
  deepReasoning: boolean;
  huggingFaceToken: string;
  temperature: number;
  topK: number;
  topP: number;
  repeatPenalty: number;
  maxTokens: number;
}

export interface GenParams {
  temp: number;
  top_k: number;
  top_p: number;
  repeat_penalty: number;
  maxTokens: number;
}
