import { loadModel, unloadModel } from '@qvac/sdk';
import { DownloadedModel } from '../types';
import { toPath } from './storage';

// Keeps the last LLM loaded in memory so screens don't reload every open
class LLMManager {
  private storageId: string | null = null;  // downloaded model ID
  private qvacId: string | null = null;     // qvac SDK model ID (returned by loadModel)
  private pending: Promise<string> | null = null;
  private pendingId: string | null = null;

  async ensure(
    model: DownloadedModel,
    modelConfig: Record<string, any>,
    onProgress?: (pct: number) => void,
  ): Promise<string> {
    // Already loaded — return immediately
    if (this.storageId === model.id && this.qvacId) {
      onProgress?.(100);
      return this.qvacId;
    }
    // Same model already loading — wait for it
    if (this.pendingId === model.id && this.pending) {
      return this.pending;
    }
    // Different model — unload current first
    if (this.qvacId) {
      await unloadModel({ modelId: this.qvacId }).catch(() => {});
      this.qvacId = null;
      this.storageId = null;
    }
    // Load the new model — QVAC SDK needs bare paths, not file:// URIs
    const nativeConfig = { ...modelConfig };
    if (nativeConfig.projectionModelSrc) {
      nativeConfig.projectionModelSrc = toPath(nativeConfig.projectionModelSrc);
    }
    this.pendingId = model.id;
    this.pending = loadModel({
      modelSrc: toPath(model.modelSrc),
      modelType: 'llm',
      modelConfig: nativeConfig,
      onProgress: (p: { percentage: number }) => onProgress?.(p.percentage),
    }).then(id => {
      this.qvacId = id;
      this.storageId = model.id;
      this.pending = null;
      this.pendingId = null;
      return id;
    }).catch(err => {
      this.pending = null;
      this.pendingId = null;
      throw err;
    });
    return this.pending;
  }

  isLoaded(storageModelId: string): boolean {
    return this.storageId === storageModelId && !!this.qvacId;
  }

  isPending(storageModelId: string): boolean {
    return this.pendingId === storageModelId && !!this.pending;
  }

  getQvacId(): string | null { return this.qvacId; }
  getLoadedModelId(): string | null { return this.storageId; }

  async release(): Promise<void> {
    if (this.qvacId) {
      await unloadModel({ modelId: this.qvacId }).catch(() => {});
    }
    this.qvacId = null;
    this.storageId = null;
    this.pending = null;
    this.pendingId = null;
  }
}

export const llmManager = new LLMManager();
