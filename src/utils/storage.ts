import AsyncStorage from '@react-native-async-storage/async-storage';
import { Paths, File, Directory } from 'expo-file-system';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { InferenceLog, AppSettings, ThemeMode, Accelerator, ResponseLength, DownloadedModel } from '../types';
import { AVAILABLE_MODELS } from './models';

// QVAC SDK expects bare filesystem paths, not file:// URIs.
export function toPath(uri: string): string {
  return uri.startsWith('file://') ? uri.slice(7) : uri;
}

const KEYS = {
  SETTINGS: '@scout_settings',
  INFERENCE_LOGS: '@scout_inference_logs',
  DOWNLOADED_MODELS: '@scout_downloaded_models',
  HF_TOKEN: 'scout_hf_token',
  CUSTOM_PROMPTS: '@scout_custom_prompts',
};

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  accelerator: 'cpu',
  responseLength: 'balanced',
  deepReasoning: false,
  huggingFaceToken: '',
  temperature: 0.7,
  topK: 20,
  topP: 0.9,
  repeatPenalty: 1.1,
  maxTokens: 1024,
};

// App-private document storage — no runtime permission required on any platform.
export function getModelsDir(): Directory {
  return new Directory(Paths.document, 'scout', 'models');
}

export async function initModelsDirectory(): Promise<void> {
  const dir = getModelsDir();
  try {
    dir.create({ intermediates: true, idempotent: true });
  } catch (e: any) {
    throw new Error(`Failed to create models dir at ${dir.uri}: ${e?.message ?? e}`);
  }
  try {
    await migrateOldModelFolders();
  } catch (e) {
    console.warn('[storage] migration skipped:', e);
  }
}

// Maps old model folder names (pre-v4) to new canonical IDs.
const FOLDER_RENAMES: Record<string, string> = {
  'medpsy-1.7b':     'text-health',
  'smolvlm2-500m-q8': 'vision',
  'smolvlm2-500m':    'vision',
};

function moveModelFiles(srcFolder: Directory, dstFolder: Directory): void {
  dstFolder.create({ intermediates: true, idempotent: true });
  const srcModel = new File(srcFolder, 'model.gguf');
  if (srcModel.exists) srcModel.move(new File(dstFolder, 'model.gguf'));
  const srcMmproj = new File(srcFolder, 'mmproj.gguf');
  if (srcMmproj.exists) srcMmproj.move(new File(dstFolder, 'mmproj.gguf'));
  try { srcFolder.delete(); } catch {}
}

async function migrateOldModelFolders(): Promise<void> {
  const modelsDir = getModelsDir();

  // Old external path used before the permission-fix (Android only, best-effort).
  // Wrapped in try because the path may not exist on all devices/package names.
  let oldExternal: Directory | null = null;
  if (Platform.OS === 'android') {
    try {
      const d = new Directory('file:///storage/emulated/0/Android/data/com.scout.app/files/scout/models');
      oldExternal = d;
    } catch { /* path doesn't exist or no permission — skip external migration */ }
  }

  const allIds = [...new Set([
    ...Object.keys(FOLDER_RENAMES),
    ...Object.values(FOLDER_RENAMES),
    'text-fast',
  ])];

  for (const id of allIds) {
    const targetId = FOLDER_RENAMES[id] ?? id;
    const dstFolder = new Directory(modelsDir, targetId);
    if (new File(dstFolder, 'model.gguf').exists) continue;

    // Same dir, old folder name
    const srcSameLoc = new Directory(modelsDir, id);
    if (srcSameLoc.exists) {
      try { moveModelFiles(srcSameLoc, dstFolder); } catch {}
      continue;
    }

    // Old external path (Android only, swallowed on permission failure)
    if (oldExternal) {
      for (const oldId of [...new Set([id, targetId])]) {
        try {
          const srcExt = new Directory(oldExternal, oldId);
          if (srcExt.exists) { moveModelFiles(srcExt, dstFolder); break; }
        } catch {}
      }
    }
  }
}

export async function syncModelsFromDisk(): Promise<DownloadedModel[]> {
  await initModelsDirectory();
  const modelsDir = getModelsDir();
  const synced: DownloadedModel[] = [];

  for (const model of AVAILABLE_MODELS) {
    const modelFolder = new Directory(modelsDir, model.id);
    const modelFile = new File(modelFolder, 'model.gguf');
    // An interrupted download leaves a partial model.gguf on disk — require
    // ~90% of the expected size so a half-file never shows as "downloaded"
    // (and never gets handed to the native loader, which would fail to load).
    const expectedModel = (model.sizeBytes - (model.mmprojBytes ?? 0)) * 0.9;
    if (!modelFile.exists || modelFile.size < Math.max(expectedModel, 1_000_000)) continue;

    const mmprojFile = new File(modelFolder, 'mmproj.gguf');
    const needsMmproj = !!model.projectionModelSrc;
    const mmprojOk = mmprojFile.exists && mmprojFile.size >= (model.mmprojBytes ?? 1) * 0.9;
    // A vision model without its projection file cannot see — treat as not downloaded
    if (needsMmproj && !mmprojOk) continue;

    synced.push({
      ...model,
      modelSrc: modelFile.uri,
      projectionModelSrc: needsMmproj ? mmprojFile.uri : undefined,
      downloadedPath: modelFile.uri,
      isDownloaded: true,
    });
  }

  await AsyncStorage.setItem(KEYS.DOWNLOADED_MODELS, JSON.stringify(synced));
  return synced;
}

export async function getSettings(): Promise<AppSettings> {
  try {
    const data = await AsyncStorage.getItem(KEYS.SETTINGS);
    if (data) return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    return DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  const current = await getSettings();
  const updated = { ...current, ...settings };
  await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(updated));
}

export async function setAccelerator(accel: Accelerator): Promise<void> {
  await saveSettings({ accelerator: accel });
}

export async function getGenParams(): Promise<{ temp: number; top_k: number; top_p: number; repeat_penalty: number; maxTokens: number }> {
  const s = await getSettings();
  return {
    temp: s.temperature ?? 0.7,
    top_k: s.topK ?? 20,
    top_p: s.topP ?? 0.9,
    repeat_penalty: s.repeatPenalty ?? 1.1,
    maxTokens: s.maxTokens ?? 1024,
  };
}

export async function setResponseLength(length: ResponseLength): Promise<void> {
  await saveSettings({ responseLength: length });
}

export async function getHfToken(): Promise<string> {
  try {
    const token = await AsyncStorage.getItem(KEYS.HF_TOKEN);
    return token || '';
  } catch {
    return '';
  }
}

export async function getInferenceLogs(): Promise<InferenceLog[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.INFERENCE_LOGS);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export async function addInferenceLog(log: InferenceLog): Promise<void> {
  const logs = await getInferenceLogs();
  logs.push(log);
  await AsyncStorage.setItem(KEYS.INFERENCE_LOGS, JSON.stringify(logs));
}

export async function getDownloadedModels(): Promise<DownloadedModel[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.DOWNLOADED_MODELS);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export async function saveDownloadedModel(model: DownloadedModel): Promise<void> {
  const models = await getDownloadedModels();
  const idx = models.findIndex((m) => m.id === model.id);
  if (idx >= 0) {
    models[idx] = model;
  } else {
    models.push(model);
  }
  await AsyncStorage.setItem(KEYS.DOWNLOADED_MODELS, JSON.stringify(models));
}

export async function removeDownloadedModel(id: string): Promise<void> {
  const models = await getDownloadedModels();
  const filtered = models.filter((m) => m.id !== id);
  await AsyncStorage.setItem(KEYS.DOWNLOADED_MODELS, JSON.stringify(filtered));
}

export async function markOnboarded(): Promise<void> {
  const version = Constants.expoConfig?.version ?? '1.0.0';
  await AsyncStorage.setItem('@scout_onboarded', 'true');
  await AsyncStorage.setItem('@scout_seen_version', version);
}

export async function shouldShowWelcome(): Promise<boolean> {
  try {
    const onboarded = await AsyncStorage.getItem('@scout_onboarded');
    if (onboarded !== 'true') return true;
    const seenVersion = await AsyncStorage.getItem('@scout_seen_version');
    const current = Constants.expoConfig?.version ?? '1.0.0';
    return seenVersion !== current;
  } catch { return false; }
}

export async function getDefaultModelId(): Promise<string | null> {
  const stored = await AsyncStorage.getItem('@scout_default_model');
  // Default to MedPsy 4B if user has never chosen
  return stored;
}

export async function setDefaultModelId(modelId: string): Promise<void> {
  await AsyncStorage.setItem('@scout_default_model', modelId);
}

export async function getThemeOverride(): Promise<'dark' | 'light' | null> {
  const val = await AsyncStorage.getItem('@scout_theme_override');
  if (val === 'dark' || val === 'light') return val;
  return null;
}

export async function setThemeOverride(mode: 'dark' | 'light'): Promise<void> {
  await AsyncStorage.setItem('@scout_theme_override', mode);
}

export async function clearAllData(): Promise<void> {
  const keys = [
    ...Object.values(KEYS),
    '@scout_onboarded',
    '@scout_theme_override',
    '@scout_default_model',
    '@scout_seen_version',
  ];
  for (const key of keys) {
    await AsyncStorage.removeItem(key);
  }
  try {
    const { getDb } = require('./historyDb') as typeof import('./historyDb');
    const db = getDb();
    db.withTransactionSync(() => {
      db.execSync('DELETE FROM messages; DELETE FROM sessions; DELETE FROM fixtures;');
    });
  } catch (e) {
    console.warn('[storage] SQLite clear failed:', e);
  }
}

