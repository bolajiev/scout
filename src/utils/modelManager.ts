import { loadModel, unloadModel } from '@qvac/sdk';
import { DownloadedModel } from '../types';
import { toPath, getSettings, saveSettings } from './storage';

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
    // BUG FIX: a DIFFERENT model requested while one is already loading
    // used to fall through both guards above (pendingId differs, and
    // qvacId is still null since the first load hasn't resolved yet) and
    // fire a SECOND native loadModel() concurrently — two loads racing
    // for the one resident-model slot, with whichever happens to resolve
    // LAST silently overwriting the other's qvacId/storageId regardless
    // of which was actually requested more recently. Queue behind the
    // existing pending load instead of racing it.
    if (this.pending) {
      await this.pending.catch(() => {});
      return this.ensure(model, modelConfig, onProgress);
    }
    // Different model — unload current first
    if (this.qvacId) {
      await unloadModel({ modelId: this.qvacId }).catch(err => {
        console.warn('[modelManager] unload failed, clearing local state anyway — native side may still hold the model resident:', err);
      });
      this.qvacId = null;
      this.storageId = null;
    }
    // Load the new model — QVAC SDK needs bare paths, not file:// URIs
    const nativeConfig = { ...modelConfig };
    if (nativeConfig.projectionModelSrc) {
      nativeConfig.projectionModelSrc = toPath(nativeConfig.projectionModelSrc);
    }
    // Engine from user settings: CPU (default, safe) or GPU (experimental,
    // OpenCL backend only — Vulkan is not shipped). 'auto' defers to setting.
    let wantGpu = false;
    if (!nativeConfig.device || nativeConfig.device === 'auto') {
      const accel = await getSettings().then(s => s.accelerator).catch(() => 'cpu' as const);
      wantGpu = accel === 'gpu';
      nativeConfig.device = wantGpu ? 'gpu' : 'cpu';
    }
    const attempt = (device: string) => loadModel({
      modelSrc: toPath(model.modelSrc),
      modelType: 'llm',
      modelConfig: { ...nativeConfig, device },
      onProgress: (p: { percentage: number }) => onProgress?.(p.percentage),
    });

    this.pendingId = model.id;
    this.pending = (async () => {
      try {
        return await attempt(nativeConfig.device as string);
      } catch (err) {
        // GPU load failed — permanently revert the setting so the app never
        // gets stuck in a GPU crash loop, then retry once on CPU
        if (!wantGpu) throw err;
        await saveSettings({ accelerator: 'cpu' }).catch(() => {});
        return await attempt('cpu');
      }
    })().then(id => {
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

  getLoadedModelId(): string | null { return this.storageId; }
  // The ID actually used for completion() calls (QVAC SDK's own model ID,
  // NOT storageId — a different ID space entirely). Screens hold this
  // value in their own `modelId` state, so anything checking "is the model
  // I loaded still resident" must compare against this, not getLoadedModelId().
  getLoadedQvacId(): string | null { return this.qvacId; }

  async release(): Promise<void> {
    if (this.qvacId) {
      await unloadModel({ modelId: this.qvacId }).catch(err => {
        console.warn('[modelManager] unload failed, clearing local state anyway — native side may still hold the model resident:', err);
      });
    }
    this.qvacId = null;
    this.storageId = null;
    this.pending = null;
    this.pendingId = null;
  }
}

export const llmManager = new LLMManager();
