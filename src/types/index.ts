export type UseCase = 'scan' | 'chat';
export type ModuleId = 'lens' | 'voice' | 'scribe' | 'deep' | 'quickchat' | 'aichat';

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

export interface Conversation {
  id: string;
  moduleId: ModuleId;
  title: string;
  createdAt: string;
  updatedAt: string;
  modelId?: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  imagePath?: string;
  thinking?: string;
  createdAt: string;
  artifactType?: 'md' | 'html';
  artifactUri?: string;
  artifactName?: string;
}

export interface DownloadedModel extends ModelInfo {
  downloadedPath: string;
  isDownloaded: true;
}

export interface ScanResult {
  type: string;
  text: string;
  query: string;
  _rawText?: string;
}

export interface HistoryItem {
  id: string;
  timestamp: string;
  query: string;
  result: ScanResult;
  imagePath?: string;
  modelName: string;
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
