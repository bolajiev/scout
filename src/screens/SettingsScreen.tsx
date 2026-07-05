import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, Switch, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useNavigation } from '@react-navigation/native';
import { getTheme } from '../theme';
import { useTheme, useThemeToggle } from '../navigation/AppNavigator';
import { pickTextCapable } from '../utils/models';
import {
  getSettings, setAccelerator, setResponseLength, clearAllData,
  saveSettings, syncModelsFromDisk, getFdApiKey, setFdApiKey,
  getFdKeyEnabled, setFdKeyEnabled,
} from '../utils/storage';
import { Accelerator, ResponseLength } from '../types';
import ConfigSlider from '../components/ConfigSlider';
import ScreenHeader from '../components/ScreenHeader';
import { getInferenceLogs, logsToCSV } from '../utils/auditLogger';

const appVersion = Constants.expoConfig?.version ?? '1.0';

export default function SettingsScreen() {
  const navigation = useNavigation<any>();
  const themeMode = useTheme();
  const toggleTheme = useThemeToggle();
  const theme = getTheme(themeMode);
  const isDark = themeMode === 'dark';
  const insets = useSafeAreaInsets();

  const [accelerator, setAccelState] = useState<Accelerator>('cpu');
  const [responseLength, setRespLength] = useState<ResponseLength>('balanced');
  const [deepReasoning, setDeepState] = useState(false);
  const [temperature, setTempState] = useState(0.7);
  const [topK, setTopKState] = useState(20);
  const [topP, setTopPState] = useState(0.9);
  const [repeatPenalty, setRepeatState] = useState(1.1);
  const [maxTokens, setMaxTokensState] = useState(1024);
  const [fdKey, setFdKeyState] = useState('');
  const [fdEnabled, setFdEnabledState] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [textModelName, setTextModelName] = useState<string | null>(null);
  const [deviceModel, setDeviceModel] = useState('');
  const [deviceBrand, setDeviceBrand] = useState('');
  const [totalMemory, setTotalMemory] = useState('N/A');

  useEffect(() => {
    loadAll();
    getFdApiKey().then(setFdKeyState).catch(() => {});
    getFdKeyEnabled().then(setFdEnabledState).catch(() => {});
  }, []);

  const loadAll = async () => {
    const [s] = await Promise.all([getSettings(), loadModelInfo(), loadDevice()]);
    setAccelState(s.accelerator);
    setRespLength(s.responseLength);
    setDeepState(s.deepReasoning ?? false);
    setTempState(s.temperature ?? 0.7);
    setTopKState(s.topK ?? 20);
    setTopPState(s.topP ?? 0.9);
    setRepeatState(s.repeatPenalty ?? 1.1);
    setMaxTokensState(s.maxTokens ?? 1024);
  };

  const loadModelInfo = async () => {
    try {
      const models = await syncModelsFromDisk();
      const text = pickTextCapable(models);
      setTextModelName(text?.name ?? null);
    } catch { setTextModelName(null); }
  };

  const loadDevice = async () => {
    setDeviceModel(Device.modelName || 'Unknown');
    setDeviceBrand(Device.brand || 'Unknown');
    const mem = (Device as any).totalMemory;
    if (mem) setTotalMemory(`${(mem / 1073741824).toFixed(1)} GB`);
  };

  const set = (patch: Record<string, any>) => saveSettings(patch as any).catch(() => {});

  const handleExportLogs = async () => {
    try {
      const logs = await getInferenceLogs();
      if (logs.length === 0) {
        Alert.alert('No logs', 'Run some inferences first, then export.');
        return;
      }
      const csv = logsToCSV(logs);
      const path = `${FileSystem.cacheDirectory}scout-inference-log.csv`;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export Inference Log' });
    } catch (e) {
      Alert.alert('Export failed', String(e));
    }
  };

  const handleClearData = () => {
    Alert.alert('Clear All Data', 'This removes all history and settings. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear', style: 'destructive',
        onPress: async () => { await clearAllData(); navigation.popToTop(); },
      },
    ]);
  };

  const OptionBtn = ({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) => (
    <TouchableOpacity
      style={[styles.optionBtn, { borderColor: theme.border }, selected && { backgroundColor: theme.accent, borderColor: theme.accent }]}
      onPress={onPress}
    >
      <Text style={[styles.optionText, { color: selected ? theme.accentFg : theme.textSecondary }]}>{label}</Text>
    </TouchableOpacity>
  );

  const Divider = () => <View style={[styles.divider, { backgroundColor: theme.border }]} />;

  const accent = theme.accent;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Settings" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* ── AI Model ─────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>AI Model</Text>
        <TouchableOpacity
          style={[styles.card, styles.modelCard, { backgroundColor: theme.card }]}
          onPress={() => navigation.navigate('Models')}
          activeOpacity={0.75}
        >
          <View style={styles.modelCardLeft}>
            <View style={[styles.modelDot, { backgroundColor: textModelName ? accent : theme.border }]} />
            <View>
              <Text style={[styles.modelName, { color: theme.text }]}>
                {textModelName ?? 'No model downloaded'}
              </Text>
              <Text style={[styles.modelSub, { color: theme.textSecondary }]}>
                {textModelName ? 'Active — tap to manage models' : 'Tap to download a model'}
              </Text>
            </View>
          </View>
          <Text style={[styles.chevron, { color: theme.textSecondary }]}>›</Text>
        </TouchableOpacity>

        {/* ── Appearance ───────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Appearance</Text>
        <View style={[styles.card, { backgroundColor: theme.card }]}>
          <View style={styles.cardRow}>
            <Text style={[styles.rowLabel, { color: theme.text }]}>Dark Mode</Text>
            <Switch
              value={isDark}
              onValueChange={() => toggleTheme()}
              trackColor={{ false: theme.border, true: accent + '80' }}
              thumbColor={isDark ? accent : theme.textSecondary}
            />
          </View>
        </View>

        {/* ── AI Behavior ──────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>AI Behavior</Text>
        <View style={[styles.card, { backgroundColor: theme.card }]}>

          {/* Response length */}
          <View style={styles.behaviorRow}>
            <View style={styles.behaviorLeft}>
              <Text style={[styles.rowLabel, { color: theme.text }]}>Response Length</Text>
              <Text style={[styles.rowHint, { color: theme.textSecondary }]}>How much detail in answers</Text>
            </View>
          </View>
          <View style={[styles.optionsRow, { marginTop: 10 }]}>
            {(['short', 'balanced', 'detailed'] as ResponseLength[]).map(opt => (
              <OptionBtn
                key={opt}
                label={opt.charAt(0).toUpperCase() + opt.slice(1)}
                selected={responseLength === opt}
                onPress={() => {
                  setRespLength(opt);
                  setResponseLength(opt);
                  set({ responseLength: opt });
                }}
              />
            ))}
          </View>

          <Divider />

          {/* Think Mode */}
          <View style={styles.cardRow}>
            <View style={styles.behaviorLeft}>
              <Text style={[styles.rowLabel, { color: theme.text }]}>Think Mode</Text>
              <Text style={[styles.rowHint, { color: theme.textSecondary }]}>AI thinks before answering in Coach</Text>
            </View>
            <Switch
              value={deepReasoning}
              onValueChange={v => { setDeepState(v); set({ deepReasoning: v }); }}
              trackColor={{ false: theme.border, true: accent + '80' }}
              thumbColor={deepReasoning ? accent : theme.textSecondary}
            />
          </View>

          <Divider />

          {/* Engine — CPU default; GPU is experimental (OpenCL backend).
              If a GPU load fails, modelManager auto-reverts to CPU. */}
          <View style={styles.cardRow}>
            <View style={styles.behaviorLeft}>
              <Text style={[styles.rowLabel, { color: theme.text }]}>Engine</Text>
              <Text style={[styles.rowHint, { color: theme.textSecondary }]}>
                {accelerator === 'gpu' ? 'GPU (experimental) — falls back to CPU if unsupported' : 'CPU — reliable on every device'}
              </Text>
            </View>
            <View style={styles.optionsRow}>
              <OptionBtn label="CPU" selected={accelerator === 'cpu'} onPress={() => { setAccelState('cpu'); setAccelerator('cpu'); }} />
              <OptionBtn label="GPU" selected={accelerator === 'gpu'} onPress={() => {
                if (accelerator === 'gpu') return;
                Alert.alert(
                  'GPU is experimental',
                  'GPU inference can be faster on supported phones, but on many devices it fails or is unstable. If loading fails, Scout automatically switches back to CPU.\n\nReload your model after changing this.',
                  [
                    { text: 'Keep CPU', style: 'cancel' },
                    { text: 'Use GPU', onPress: () => { setAccelState('gpu'); setAccelerator('gpu'); } },
                  ],
                );
              }} />
            </View>
          </View>

        </View>

        {/* ── Live Data ────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Live Data</Text>
        <View style={[styles.card, { backgroundColor: theme.card }]}>
          <View style={styles.cardRow}>
            <View style={styles.behaviorLeft}>
              <Text style={[styles.rowLabel, { color: theme.text }]}>Premium live data</Text>
              <Text style={[styles.rowHint, { color: fdKey && fdEnabled ? accent : theme.textSecondary }]}>
                {!fdKey.trim()
                  ? 'Using free data. Paste a free football-data.org key below to unlock 12 leagues.'
                  : fdEnabled
                    ? 'ON — football-data.org: WC, PL, UCL + 9 leagues, live scores'
                    : 'OFF — key saved, using the free source (TheSportsDB)'}
              </Text>
            </View>
            <Switch
              value={fdEnabled && fdKey.trim().length > 0}
              disabled={fdKey.trim().length === 0}
              onValueChange={v => { setFdEnabledState(v); setFdKeyEnabled(v).catch(() => {}); }}
              trackColor={{ true: accent + '80', false: theme.border }}
              thumbColor={fdEnabled && fdKey.trim().length > 0 ? accent : theme.textSecondary}
            />
          </View>
          <TextInput
            style={[styles.keyInput, { backgroundColor: theme.cardAlt, color: theme.text }, fdKey && fdEnabled ? { borderWidth: 1, borderColor: accent + '50' } : null]}
            placeholder="Paste API key (leave empty to use free data)"
            placeholderTextColor={theme.textSecondary}
            value={fdKey}
            onChangeText={t => { setFdKeyState(t); setFdApiKey(t).catch(() => {}); }}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* ── Device ───────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Device</Text>
        <View style={[styles.card, { backgroundColor: theme.card }]}>
          {[['Model', deviceModel], ['Brand', deviceBrand], ['RAM', totalMemory]].map(([k, v]) => (
            <View key={k} style={styles.infoRow}>
              <Text style={[styles.infoKey, { color: theme.textSecondary }]}>{k}</Text>
              <Text style={[styles.infoVal, { color: theme.text }]}>{v}</Text>
            </View>
          ))}
        </View>

        {/* ── QVAC privacy ─────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: accent + '35', borderWidth: 1 }]}>
          <View style={styles.qvacRow}>
            <View style={[styles.qvacDot, { backgroundColor: accent }]} />
            <Text style={[styles.qvacName, { color: accent }]}>qvac</Text>
            <View style={[styles.qvacBadge, { backgroundColor: accent + '20' }]}>
              <Text style={[styles.qvacBadgeText, { color: accent }]}>On-Device AI</Text>
            </View>
          </View>
          <Text style={[styles.qvacDesc, { color: theme.textSecondary }]}>
            All AI inference runs locally using the QVAC SDK — no cloud, no servers, your data never leaves your phone.
          </Text>
        </View>

        {/* ── Advanced ─────────────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.advancedToggle, { borderColor: theme.border }]}
          onPress={() => setShowAdvanced(v => !v)}
          activeOpacity={0.7}
        >
          <Text style={[styles.advancedLabel, { color: theme.textSecondary }]}>Advanced</Text>
          <Text style={[styles.advancedChevron, { color: theme.textSecondary }]}>{showAdvanced ? '∧' : '∨'}</Text>
        </TouchableOpacity>

        {showAdvanced && (
          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <ConfigSlider
              label="Max tokens"
              value={maxTokens}
              min={256}
              max={32000}
              step={256}
              decimals={0}
              warn={maxTokens > 10000 ? 'Above 10000 may be unstable.' : null}
              theme={theme}
              onChange={v => { setMaxTokensState(v); set({ maxTokens: v }); }}
            />
            <Divider />
            <ConfigSlider
              label="Temperature"
              value={temperature}
              min={0}
              max={2}
              step={0.01}
              decimals={2}
              warn={null}
              theme={theme}
              onChange={v => { setTempState(v); set({ temperature: v }); }}
            />
            <Divider />
            <ConfigSlider
              label="TopK"
              value={topK}
              min={1}
              max={100}
              step={1}
              decimals={0}
              warn={null}
              theme={theme}
              onChange={v => { setTopKState(v); set({ topK: v }); }}
            />
            <Divider />
            <ConfigSlider
              label="TopP"
              value={topP}
              min={0}
              max={1}
              step={0.01}
              decimals={2}
              warn={null}
              theme={theme}
              onChange={v => { setTopPState(v); set({ topP: v }); }}
            />
            <Divider />
            <ConfigSlider
              label="Repeat Penalty"
              value={repeatPenalty}
              min={1.0}
              max={1.8}
              step={0.05}
              decimals={2}
              warn={null}
              theme={theme}
              onChange={v => { setRepeatState(v); set({ repeatPenalty: v }); }}
            />
          </View>
        )}

        {/* ── Actions ──────────────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.actionBtn, { borderColor: theme.border, backgroundColor: theme.card }]}
          onPress={handleExportLogs}
        >
          <Text style={[styles.actionText, { color: theme.text }]}>Export Inference Log (CSV)</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.dangerBtn, { borderColor: theme.error }]}
          onPress={handleClearData}
        >
          <Text style={[styles.dangerText, { color: theme.error }]}>Clear All Data</Text>
        </TouchableOpacity>

        <Text style={[styles.footer, { color: theme.textSecondary }]}>
          {`Scout v${appVersion} · QVAC SDK · On-Device Football AI`}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 60, gap: 6 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1,
    textTransform: 'uppercase', marginTop: 20, marginBottom: 6,
  },

  // Card
  card: { borderRadius: 14, padding: 16, gap: 12 },
  keyInput: {
    borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 13,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  divider: { height: StyleSheet.hairlineWidth },

  // Model card
  modelCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  modelCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  modelDot: { width: 10, height: 10, borderRadius: 5 },
  modelName: { fontSize: 15, fontWeight: '700' },
  modelSub: { fontSize: 12, marginTop: 2 },
  chevron: { fontSize: 22, fontWeight: '300' },

  // AI Behavior
  behaviorRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  behaviorLeft: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15, fontWeight: '600' },
  rowHint: { fontSize: 12 },
  optionsRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  optionBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  optionText: { fontSize: 13, fontWeight: '600' },

  // Device info
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  infoKey: { fontSize: 14 },
  infoVal: { fontSize: 14, fontWeight: '600' },

  // QVAC
  qvacRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  qvacDot: { width: 8, height: 8, borderRadius: 4 },
  qvacName: { fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  qvacBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 4 },
  qvacBadgeText: { fontSize: 11, fontWeight: '700' },
  qvacDesc: { fontSize: 13, lineHeight: 19 },

  // Advanced toggle
  advancedToggle: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 14, paddingVertical: 12, paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  advancedLabel: { fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },
  advancedChevron: { fontSize: 14 },

  // Actions
  actionBtn: { borderRadius: 14, paddingVertical: 16, alignItems: 'center', borderWidth: 1, marginTop: 10 },
  actionText: { fontSize: 15, fontWeight: '600' },
  dangerBtn: { borderRadius: 14, paddingVertical: 16, alignItems: 'center', borderWidth: 1, marginTop: 10 },
  dangerText: { fontSize: 15, fontWeight: '700' },
  footer: { fontSize: 12, textAlign: 'center', marginTop: 20 },
});
