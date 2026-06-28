import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { File, Directory } from 'expo-file-system';
import { createDownloadResumable } from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  registerDownloadCancel, unregisterDownloadCancel,
  showDownloadProgressNotification, showDownloadDoneNotification,
  clearDownloadNotification, requestNotificationPermission,
} from '../utils/bgNotification';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import {
  getHfToken, getModelsDir, initModelsDirectory, syncModelsFromDisk,
} from '../utils/storage';
import { AVAILABLE_MODELS, getHfDownloadUrl } from '../utils/models';
import { ModelInfo } from '../types';

type Phase = 'downloading' | 'done' | 'failed';

function formatBytes(bytes: number): string {
  const gb = bytes / 1e9;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

function formatSpeed(bps: number): string {
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} MB/s`;
  if (bps >= 1e3) return `${Math.round(bps / 1e3)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

export default function DownloadScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  // modelId: which model to download (e.g. 'text-fast', 'vision')
  // returnTo: screen to navigate to after success
  // returnParams: params to pass to returnTo
  const modelId: string = route.params?.modelId;
  const returnTo: string = route.params?.returnTo ?? 'Main';
  const returnParams: Record<string, any> = route.params?.returnParams ?? {};
  const themeMode = useTheme();
  const theme = getTheme(themeMode);

  const [phase, setPhase] = useState<Phase>('downloading');
  const [label, setLabel] = useState('Downloading…');
  const [pct, setPct] = useState(0);
  const [bytesWritten, setBytesWritten] = useState(0);
  const [bytesTotal, setBytesTotal] = useState(0);
  const [speedBps, setSpeedBps] = useState(0);
  const [isResuming, setIsResuming] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const dlRef = useRef<ReturnType<typeof createDownloadResumable> | null>(null);
  const currentResumeKeyRef = useRef('');
  const lastBytesRef = useRef(0);
  const lastTimeRef = useRef(Date.now());

  useEffect(() => {
    void requestNotificationPermission();
    registerDownloadCancel(handleCancel);
    Animated.timing(fadeAnim, { toValue: 1, duration: 320, useNativeDriver: true }).start();
    runDownload();
    return () => {
      mountedRef.current = false;
      unregisterDownloadCancel();
      void clearDownloadNotification();
      // Android back gesture — pause and save resume state without blocking unmount
      if (dlRef.current && currentResumeKeyRef.current && !cancelledRef.current) {
        cancelledRef.current = true;
        dlRef.current.pauseAsync().then(state => {
          AsyncStorage.setItem(currentResumeKeyRef.current, JSON.stringify(state)).catch(() => {});
        }).catch(() => {});
      }
    };
  }, []);

  const model = AVAILABLE_MODELS.find(m => m.id === modelId);

  const runDownload = async () => {
    const m = AVAILABLE_MODELS.find(x => x.id === modelId);
    if (!m) {
      setErrorMsg('Unknown model.');
      setPhase('failed');
      return;
    }
    await initModelsDirectory();
    const token = await getHfToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      await downloadFile(m, m.modelSrc, 'model.gguf', headers, 0, m.projectionModelSrc ? 80 : 100, 'Downloading model…');
      if (cancelledRef.current) return;

      if (m.projectionModelSrc) {
        await downloadFile(m, m.projectionModelSrc, 'mmproj.gguf', headers, 80, 100, 'Downloading vision file…');
        if (cancelledRef.current) return;
      }

      await syncModelsFromDisk();
      void showDownloadDoneNotification(m.name);
      setPhase('done');
      setTimeout(() => {
        if (!cancelledRef.current) {
          navigation.replace(returnTo, returnParams);
        }
      }, 600);
    } catch (err: any) {
      void clearDownloadNotification();
      if (cancelledRef.current) return;
      const msg = (err?.message || 'Download failed').replace(/file:\/\/[^\s,]*/g, '[path]');
      setErrorMsg(`Couldn't download ${m.name}. ${msg}`);
      setPhase('failed');
    }
  };

  const downloadFile = async (
    m: ModelInfo,
    src: string,
    filename: string,
    headers: Record<string, string>,
    startPct: number,
    endPct: number,
    labelText: string,
  ) => {
    setLabel(labelText);
    const folder = new Directory(getModelsDir(), m.id);
    folder.create({ intermediates: true, idempotent: true });
    const destUri = new File(folder, filename).uri;
    const url = getHfDownloadUrl(src);

    // Load resume state if available
    const resumeKey = `@peek_dl_resume_${m.id}_${filename}`;
    currentResumeKeyRef.current = resumeKey;
    let resumeData: string | undefined;
    try {
      const savedStr = await AsyncStorage.getItem(resumeKey);
      if (savedStr) {
        const savedState = JSON.parse(savedStr);
        const partialFile = new File(savedState.fileUri ?? destUri);
        if (partialFile.exists && savedState.resumeData) {
          resumeData = savedState.resumeData;
          setIsResuming(true);
        } else {
          // Partial file exists but no resumeData, or file gone — clear stale state
          await AsyncStorage.removeItem(resumeKey);
        }
      }
    } catch {}

    lastBytesRef.current = 0;
    lastTimeRef.current = Date.now();

    // Show notification immediately so it's visible before any progress callback fires
    void showDownloadProgressNotification(m.name, labelText, startPct, 0, m.sizeBytes ?? 0, 0, true);

    const dl = createDownloadResumable(url, destUri, { headers }, (p) => {
      if (cancelledRef.current || !mountedRef.current) return;

      // Speed calculation — update every 0.5s
      const now = Date.now();
      const dt = (now - lastTimeRef.current) / 1000;
      let currentSpeed = speedBps;
      if (dt >= 0.5) {
        const delta = p.totalBytesWritten - lastBytesRef.current;
        currentSpeed = Math.round(delta / dt);
        setSpeedBps(currentSpeed);
        lastBytesRef.current = p.totalBytesWritten;
        lastTimeRef.current = now;
      }

      const filePct = p.totalBytesExpectedToWrite > 0
        ? (p.totalBytesWritten / p.totalBytesExpectedToWrite)
        : 0;
      const overallPct = Math.round(startPct + filePct * (endPct - startPct));
      setPct(overallPct);
      setBytesWritten(p.totalBytesWritten);
      const total = p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : (m.sizeBytes ?? 0);
      setBytesTotal(total);
      void showDownloadProgressNotification(m.name, labelText, overallPct, p.totalBytesWritten, total, currentSpeed);
    }, resumeData);

    dlRef.current = dl;

    const result = await dl.downloadAsync();
    if (!result) throw new Error('Download cancelled');
    // 206 Partial Content is expected when resuming
    if (result.status !== 200 && result.status !== 206) throw new Error(`HTTP ${result.status}`);

    await AsyncStorage.removeItem(resumeKey).catch(() => {});
    dlRef.current = null;
    setIsResuming(false);
    setSpeedBps(0);
  };

  const handleCancel = async () => {
    cancelledRef.current = true;
    // Pause download and save state so next open can resume
    if (dlRef.current && currentResumeKeyRef.current) {
      try {
        const pauseState = await dlRef.current.pauseAsync();
        await AsyncStorage.setItem(currentResumeKeyRef.current, JSON.stringify(pauseState));
      } catch {}
    }
    // Guard: notification may trigger this after screen unmounts
    if (mountedRef.current) navigation.goBack();
  };

  const handleRetry = () => {
    cancelledRef.current = false;
    setPhase('downloading');
    setPct(0);
    setBytesWritten(0);
    setBytesTotal(0);
    setSpeedBps(0);
    setIsResuming(false);
    setErrorMsg('');
    runDownload();
  };

  return (
    <Animated.View style={[styles.root, { backgroundColor: theme.background, opacity: fadeAnim }]}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <View style={styles.brand}>
          <View style={[styles.brandDot, { backgroundColor: theme.accent }]} />
          <Text style={[styles.brandName, { color: theme.text }]}>Peek</Text>
        </View>
      </View>

      <View style={styles.body}>
        <View style={[styles.iconBox, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={[styles.iconDot, { backgroundColor: theme.accent }]} />
        </View>

        <Text style={[styles.title, { color: theme.text }]}>
          {phase === 'failed' ? 'Download Failed' : phase === 'done' ? 'Ready!' : model?.name ?? 'Downloading…'}
        </Text>

        {model && phase !== 'failed' && (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            {model.size} · on-device · private
          </Text>
        )}

        {phase === 'failed' && (
          <Text selectable style={[styles.errorMsg, { color: theme.error }]}>{errorMsg}</Text>
        )}

        {phase === 'downloading' && (
          <>
            <Text style={[styles.phaseLabel, { color: theme.textSecondary }]}>
              {isResuming ? 'Resuming…' : label}
            </Text>
            <View style={[styles.trackOuter, { backgroundColor: theme.border }]}>
              <View style={[styles.trackFill, { backgroundColor: theme.accent, width: `${pct}%` }]} />
            </View>
            <Text style={[styles.pctText, { color: theme.textSecondary }]}>
              {pct}%
              {bytesTotal > 0 ? `  ·  ${formatBytes(bytesWritten)} / ${formatBytes(bytesTotal)}` : ''}
              {speedBps > 0 ? `  ·  ${formatSpeed(speedBps)}` : ''}
            </Text>
            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: theme.border }]}
              onPress={handleCancel}
              activeOpacity={0.7}
            >
              <Text style={[styles.cancelBtnText, { color: theme.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
          </>
        )}

        {phase === 'done' && (
          <Text style={[styles.phaseLabel, { color: theme.textSecondary }]}>Launching…</Text>
        )}

        {phase === 'failed' && (
          <>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: theme.accent }]}
              onPress={handleRetry}
              activeOpacity={0.85}
            >
              <Text style={[styles.primaryBtnText, { color: theme.accentFg }]}>Try Again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: theme.border }]}
              onPress={() => navigation.navigate('Models')}
              activeOpacity={0.7}
            >
              <Text style={[styles.secondaryBtnText, { color: theme.text }]}>Manage Models</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingTop: 56, paddingHorizontal: 20, paddingBottom: 13, borderBottomWidth: 1,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brandDot: { width: 7, height: 7, borderRadius: 3.5 },
  brandName: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  body: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 40, gap: 16,
  },
  iconBox: {
    width: 72, height: 72, borderRadius: 22, borderWidth: 1,
    justifyContent: 'center', alignItems: 'center', marginBottom: 8,
  },
  iconDot: { width: 20, height: 20, borderRadius: 10 },
  title: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center' },
  subtitle: { fontSize: 13, textAlign: 'center', marginTop: -8 },
  phaseLabel: { fontSize: 13, textAlign: 'center' },
  errorMsg: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  trackOuter: { width: '100%', height: 6, borderRadius: 3, overflow: 'hidden' },
  trackFill: { height: 6, borderRadius: 3 },
  pctText: { fontSize: 12 },
  cancelBtn: {
    marginTop: 4, paddingHorizontal: 24, paddingVertical: 11,
    borderRadius: 12, borderWidth: 1,
  },
  cancelBtnText: { fontSize: 14, fontWeight: '600' },
  primaryBtn: {
    width: '100%', paddingVertical: 15, borderRadius: 14, alignItems: 'center',
  },
  primaryBtnText: { fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    width: '100%', paddingVertical: 15, borderRadius: 14,
    alignItems: 'center', borderWidth: 1,
  },
  secondaryBtnText: { fontSize: 15, fontWeight: '600' },
});
