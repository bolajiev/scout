import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { File, Directory } from 'expo-file-system';
import { createDownloadResumable } from 'expo-file-system/legacy';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { AVAILABLE_MODELS, getHfDownloadUrl, MODEL_KEYS } from '../utils/models';
import {
  saveDownloadedModel,
  removeDownloadedModel,
  getHfToken,
  getModelsDir,
  initModelsDirectory,
  syncModelsFromDisk,
  getDefaultModelId,
  setDefaultModelId,
} from '../utils/storage';
import { ModelInfo, DownloadedModel } from '../types';
import { llmManager } from '../utils/modelManager';

type DownloadPhase = {
  phase: 'model' | 'mmproj';
  pct: number;
  bytesWritten: number;
  bytesTotal: number;
  speedBps: number;
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const gb = bytes / 1e9;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

function formatSpeed(bps: number): string {
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} MB/s`;
  if (bps >= 1e3) return `${Math.round(bps / 1e3)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

export default function ModelsScreen() {
  const navigation = useNavigation<any>();
  const theme = getTheme(useTheme());
  const [downloadedModels, setDownloadedModels] = useState<DownloadedModel[]>([]);
  const [downloading, setDownloading] = useState<Record<string, DownloadPhase>>({});
  const [defaultTextModelId, setDefaultTextModelIdState] = useState<string>(MODEL_KEYS.TEXT_FAST);
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState(0);

  useEffect(() => {
    init();
  }, []);

  useFocusEffect(useCallback(() => { void init(); }, []));

  const init = async () => {
    try {
      await initModelsDirectory();
      const synced = await syncModelsFromDisk();
      setDownloadedModels(synced);
      const def = await getDefaultModelId();
      if (def) setDefaultTextModelIdState(def);
    } catch (e) {
      console.warn('[ModelsScreen] init failed:', e);
    }
    setLoadedModelId(llmManager.getLoadedModelId());
  };

  const handleSetDefault = async (modelId: string) => {
    await setDefaultModelId(modelId);
    setDefaultTextModelIdState(modelId);
  };

  const loadDownloaded = async () => {
    const models = await syncModelsFromDisk();
    setDownloadedModels(models);
  };

  const isDownloaded = (modelId: string) =>
    downloadedModels.some((m) => m.id === modelId);

  const startDownload = async (model: ModelInfo) => {
    const token = await getHfToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const modelFolder = new Directory(getModelsDir(), model.id);
    await modelFolder.create({ intermediates: true, idempotent: true });

    setDownloading((prev) => ({
      ...prev,
      [model.id]: { phase: 'model', pct: 0, bytesWritten: 0, bytesTotal: model.sizeBytes, speedBps: 0 },
    }));

    try {
      const url = getHfDownloadUrl(model.modelSrc);
      const fileUri = new File(modelFolder, 'model.gguf').uri;

      let lastBytes = 0;
      let lastTime = Date.now();
      const dl = createDownloadResumable(url, fileUri, { headers }, (p) => {
        const pct = p.totalBytesExpectedToWrite > 0
          ? Math.round((p.totalBytesWritten / p.totalBytesExpectedToWrite) * 100)
          : 0;
        const now = Date.now();
        const dt = (now - lastTime) / 1000;
        let speedBps = 0;
        if (dt >= 0.5) {
          speedBps = Math.round((p.totalBytesWritten - lastBytes) / dt);
          lastBytes = p.totalBytesWritten;
          lastTime = now;
        }
        setDownloading((prev) => ({
          ...prev,
          [model.id]: {
            phase: 'model', pct,
            bytesWritten: p.totalBytesWritten,
            bytesTotal: p.totalBytesExpectedToWrite,
            speedBps: speedBps > 0 ? speedBps : (prev[model.id]?.speedBps ?? 0),
          },
        }));
      });

      const result = await dl.downloadAsync();
      if (!result) throw new Error('Download cancelled');
      if (result.status !== 200 && result.status !== 206) throw new Error(`HTTP ${result.status}`);

      let localProjectionSrc: string | undefined;

      if (model.projectionModelSrc) {
        setDownloading((prev) => ({
          ...prev,
          [model.id]: { phase: 'mmproj', pct: 0, bytesWritten: 0, bytesTotal: 0, speedBps: 0 },
        }));

        const mmUrl = getHfDownloadUrl(model.projectionModelSrc);
        const mmUri = new File(modelFolder, 'mmproj.gguf').uri;

        let mmLastBytes = 0;
        let mmLastTime = Date.now();
        const mmDl = createDownloadResumable(mmUrl, mmUri, { headers }, (p) => {
          const pct = p.totalBytesExpectedToWrite > 0
            ? Math.round((p.totalBytesWritten / p.totalBytesExpectedToWrite) * 100)
            : 0;
          const now = Date.now();
          const dt = (now - mmLastTime) / 1000;
          let speedBps = 0;
          if (dt >= 0.5) {
            speedBps = Math.round((p.totalBytesWritten - mmLastBytes) / dt);
            mmLastBytes = p.totalBytesWritten;
            mmLastTime = now;
          }
          setDownloading((prev) => ({
            ...prev,
            [model.id]: {
              phase: 'mmproj', pct,
              bytesWritten: p.totalBytesWritten,
              bytesTotal: p.totalBytesExpectedToWrite,
              speedBps: speedBps > 0 ? speedBps : (prev[model.id]?.speedBps ?? 0),
            },
          }));
        });

        const mmResult = await mmDl.downloadAsync();
        if (!mmResult) throw new Error('mmproj download cancelled');
        if (mmResult.status !== 200 && mmResult.status !== 206) throw new Error(`HTTP ${mmResult.status}`);
        localProjectionSrc = mmResult.uri;
      }

      const newModel: DownloadedModel = {
        ...model,
        modelSrc: result.uri,
        projectionModelSrc: localProjectionSrc,
        downloadedPath: result.uri,
        isDownloaded: true,
      };
      await saveDownloadedModel(newModel);
      setDownloading((prev) => { const n = { ...prev }; delete n[model.id]; return n; });
      await loadDownloaded();
    } catch {
      setDownloading((prev) => { const n = { ...prev }; delete n[model.id]; return n; });
      Alert.alert('Download Failed', 'Could not download the model. Check your internet connection and try again.');
    }
  };

  const handleDownload = (model: ModelInfo) => {
    const hasProjection = !!model.projectionModelSrc;
    const sizeLabel = `${model.size}${hasProjection ? ' + vision file' : ''}`;
    const isLarge = model.sizeBytes > 1.5e9;
    const timeHint = isLarge ? '5–15 minutes on Wi-Fi.' : '2–5 minutes on Wi-Fi.';

    Alert.alert(
      'Before You Download',
      `${model.name} · ${sizeLabel}\n\n` +
      `• Connect to Wi-Fi — mobile data will be used otherwise\n` +
      `• Keep the app open until the download finishes\n` +
      `• Download takes ${timeHint}\n` +
      (isLarge ? `• You need ${sizeLabel} of free storage\n` : '') +
      `\nThe model runs 100% on your device — no data is sent anywhere.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Download', onPress: () => startDownload(model) },
      ]
    );
  };

  const handleLoad = async (model: DownloadedModel) => {
    if (loadingModelId) return;
    setLoadingModelId(model.id);
    setLoadProgress(0);
    try {
      await llmManager.ensure(
        model,
        { ctx_size: 4096, device: 'auto', tools: model.modelType !== 'vision' },
        pct => setLoadProgress(Math.round(pct)),
      );
      setLoadedModelId(llmManager.getLoadedModelId());
    } catch {
      Alert.alert('Load Failed', 'Could not load the model into memory. Try restarting the app.');
    } finally {
      setLoadingModelId(null);
      setLoadProgress(0);
    }
  };

  const handleUnload = async () => {
    await llmManager.release();
    setLoadedModelId(null);
  };

  const handleDelete = (model: DownloadedModel) => {
    Alert.alert(
      'Remove Model',
      `Delete ${model.name} from your device? You can download it again later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => doDelete(model.id) },
      ]
    );
  };

  const doDelete = async (modelId: string) => {
    const folder = new Directory(getModelsDir(), modelId);
    try {
      if (folder.exists) await folder.delete();
    } catch {}
    await removeDownloadedModel(modelId);
    await loadDownloaded();
  };

  const renderProgress = (modelId: string) => {
    const state = downloading[modelId];
    if (!state) return null;

    const label = state.phase === 'model' ? 'Downloading model' : 'Downloading vision file';
    const byteDetail = state.bytesTotal > 0
      ? `${formatBytes(state.bytesWritten)} / ${formatBytes(state.bytesTotal)}`
      : `${state.pct}%`;
    const detail = state.speedBps > 0 ? `${byteDetail}  ·  ${formatSpeed(state.speedBps)}` : byteDetail;

    return (
      <View style={styles.progressWrapper}>
        <View style={styles.progressHeader}>
          <Text style={[styles.progressLabel, { color: theme.text }]}>{label}…</Text>
          <Text style={[styles.progressDetail, { color: theme.textSecondary }]}>{detail}</Text>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
          <View style={[styles.progressFill, { backgroundColor: theme.accent, width: `${state.pct}%` }]} />
        </View>
      </View>
    );
  };

  const renderModelCard = (model: ModelInfo, showDelete: boolean) => {
    const dl = isDownloaded(model.id);
    const isDownloading = downloading[model.id] !== undefined;
    const isVision = !!model.projectionModelSrc;
    const dlModel = showDelete ? downloadedModels.find((m) => m.id === model.id) : null;
    const isLoaded = loadedModelId === model.id;
    const isLoadingThis = loadingModelId === model.id;
    const accent = theme.accent;

    return (
      <View
        key={model.id}
        style={[
          styles.modelCard,
          { backgroundColor: theme.card },
          isLoaded && { borderWidth: 1, borderColor: accent + '50' },
        ]}
      >
        {/* Top row: model name + actions */}
        <View style={styles.cardTop}>
          <View style={styles.cardTopLeft}>
            <Text style={[styles.modelName, { color: theme.text }]}>{model.name}</Text>
            {model.tagline && (
              <Text style={[styles.modelTagline, { color: theme.textSecondary }]}>{model.tagline}</Text>
            )}
          </View>

          {!isDownloading && !isLoadingThis && (
            <View style={styles.cardActions}>
              {dl ? (
                <>
                  {isLoaded ? (
                    <TouchableOpacity
                      style={[styles.stopBtn, { borderColor: theme.error }]}
                      onPress={handleUnload}
                    >
                      <Text style={[styles.stopBtnText, { color: theme.error }]}>Stop</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.loadBtn, { backgroundColor: accent + '20', borderColor: accent + '60' }]}
                      onPress={() => dlModel && handleLoad(dlModel)}
                    >
                      <Text style={[styles.loadBtnText, { color: accent }]}>Start</Text>
                    </TouchableOpacity>
                  )}
                  {showDelete && dlModel && !isLoaded && (
                    <TouchableOpacity
                      style={[styles.deleteBtn, { borderColor: theme.error }]}
                      onPress={() => handleDelete(dlModel)}
                    >
                      <Text style={[styles.deleteBtnText, { color: theme.error }]}>Delete</Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                <TouchableOpacity
                  style={[styles.downloadBtn, { backgroundColor: accent }]}
                  onPress={() => handleDownload(model)}
                >
                  <Text style={[styles.downloadBtnText, { color: theme.accentFg }]}>Get</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* In-memory status badge */}
        {isLoaded && (
          <View style={[styles.loadedBadge, { backgroundColor: accent + '18', borderColor: accent + '40' }]}>
            <View style={[styles.loadedDot, { backgroundColor: accent }]} />
            <Text style={[styles.loadedText, { color: accent }]}>In memory — ready</Text>
          </View>
        )}

        {/* Loading into memory progress */}
        {isLoadingThis && (
          <View style={styles.progressWrapper}>
            <View style={styles.progressHeader}>
              <Text style={[styles.progressLabel, { color: theme.text }]}>Loading into memory...</Text>
              <Text style={[styles.progressDetail, { color: theme.textSecondary }]}>{loadProgress}%</Text>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
              <View style={[styles.progressFill, { backgroundColor: accent, width: `${loadProgress}%` }]} />
            </View>
          </View>
        )}

        {/* Description */}
        {model.description && (
          <Text style={[styles.modelDescription, { color: theme.textSecondary }]}>
            {model.description}
          </Text>
        )}

        {/* Chips row */}
        <View style={styles.chipsRow}>
          <View style={[styles.chip, { borderColor: theme.border }]}>
            <Text style={[styles.chipText, { color: theme.textSecondary }]}>{model.size}</Text>
          </View>
          {isVision ? (
            <View style={[styles.chip, { borderColor: theme.visionChip + '66', backgroundColor: theme.visionChip + '15' }]}>
              <Text style={[styles.chipText, { color: theme.visionChip }]}>Vision</Text>
            </View>
          ) : (
            <View style={[styles.chip, { borderColor: theme.border }]}>
              <Text style={[styles.chipText, { color: theme.textSecondary }]}>Text Only</Text>
            </View>
          )}
          {model.heavy && (
            <View style={[styles.chip, { borderColor: '#e07000aa', backgroundColor: '#e0700012' }]}>
              <Text style={[styles.chipText, { color: '#e07000' }]}>Needs 3 GB+ RAM</Text>
            </View>
          )}
        </View>

        {isDownloading && renderProgress(model.id)}
      </View>
    );
  };

  const downloadedTextModels = downloadedModels.filter(m => m.modelType === 'text');

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        {/* Default text model selector — shown when 2+ text models are downloaded */}
        {downloadedTextModels.length >= 2 && (
          <View style={[styles.defaultSection, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.defaultTitle, { color: theme.text }]}>Default Text Model</Text>
            <Text style={[styles.defaultSub, { color: theme.textSecondary }]}>Used for AI Coach and Predictor</Text>
            <View style={styles.defaultRow}>
              {downloadedTextModels.map(m => (
                <TouchableOpacity
                  key={m.id}
                  style={[
                    styles.defaultOption,
                    { borderColor: defaultTextModelId === m.id ? theme.accent : theme.border },
                    defaultTextModelId === m.id && { backgroundColor: theme.accent + '18' },
                  ]}
                  onPress={() => handleSetDefault(m.id)}
                  activeOpacity={0.7}
                >
                  {defaultTextModelId === m.id && (
                    <View style={[styles.defaultCheck, { backgroundColor: theme.accent }]} />
                  )}
                  <Text style={[styles.defaultOptionText, { color: defaultTextModelId === m.id ? theme.accent : theme.textSecondary }]} numberOfLines={2}>
                    {m.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {downloadedModels.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>On Device</Text>
              <View style={[styles.countBadge, { backgroundColor: theme.accent }]}>
                <Text style={[styles.countText, { color: theme.accentFg }]}>{downloadedModels.length}</Text>
              </View>
            </View>
            {downloadedModels.map((m) => renderModelCard(m, true))}
          </>
        )}

        <View style={[styles.sectionHeader, downloadedModels.length > 0 && { marginTop: 28 }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Available Models</Text>
        </View>

        <Text style={[styles.sectionHint, { color: theme.textSecondary }]}>
          All models run entirely on your device — your data never leaves your phone.
        </Text>

        {AVAILABLE_MODELS.map((m) => renderModelCard(m, false))}

        <View style={{ height: 48 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 12 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10,
  },
  sectionTitle: { fontSize: 19, fontWeight: '700' },
  sectionHint: { fontSize: 13, marginBottom: 16, lineHeight: 18 },
  countBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  countText: { fontSize: 12, fontWeight: '700' },
  modelCard: {
    borderRadius: 16, padding: 16, marginBottom: 12,
  },
  cardTop: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between', marginBottom: 8,
  },
  cardTopLeft: { flex: 1 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 8 },
  checkmark: {
    borderRadius: 8, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  checkmarkText: { fontSize: 12, fontWeight: '600' },
  downloadBtn: {
    borderRadius: 10, paddingHorizontal: 18, paddingVertical: 8,
  },
  downloadBtnText: { fontSize: 14, fontWeight: '700' },
  loadBtn: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7,
  },
  loadBtnText: { fontSize: 13, fontWeight: '700' },
  stopBtn: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7,
  },
  stopBtnText: { fontSize: 13, fontWeight: '700' },
  deleteBtn: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  deleteBtnText: { fontSize: 13, fontWeight: '600' },
  loadedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    alignSelf: 'flex-start', marginBottom: 4,
  },
  loadedDot: { width: 7, height: 7, borderRadius: 4 },
  loadedText: { fontSize: 12, fontWeight: '600' },
  modelName: { fontSize: 16, fontWeight: '700', marginBottom: 2 },
  modelTagline: { fontSize: 12, lineHeight: 16 },
  modelDescription: { fontSize: 13, lineHeight: 18, marginBottom: 10, marginTop: 8 },
  chipsRow: { flexDirection: 'row', gap: 6 },
  chip: {
    borderWidth: 1, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  chipText: { fontSize: 12, fontWeight: '500' },
  progressWrapper: { marginTop: 14 },
  progressHeader: {
    flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6,
  },
  progressLabel: { fontSize: 13, fontWeight: '600' },
  progressDetail: { fontSize: 12 },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  defaultSection: {
    borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 20,
  },
  defaultTitle: { fontSize: 14, fontWeight: '700', marginBottom: 3 },
  defaultSub: { fontSize: 12, marginBottom: 12 },
  defaultRow: { flexDirection: 'row', gap: 8 },
  defaultOption: {
    flex: 1, borderWidth: 1.5, borderRadius: 12,
    padding: 12, alignItems: 'center', gap: 6,
  },
  defaultCheck: { width: 8, height: 8, borderRadius: 4 },
  defaultOptionText: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
});
