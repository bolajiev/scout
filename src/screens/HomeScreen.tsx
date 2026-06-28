import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated,
  Dimensions,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { getTheme } from '../theme';
import { useTheme, useSidebar } from '../navigation/AppNavigator';
import {
  IconLens, IconVoice, IconScribe, IconDeep, IconChat, IconMenu, IconNearby, IconGame,
} from '../components/Icons';
import { syncModelsFromDisk } from '../utils/storage';
import { MODEL_KEYS } from '../utils/models';
import { DownloadedModel } from '../types';

const { width: SW } = Dimensions.get('window');
const H_PAD = 12;
const CARD_GAP = 10;
const CARD_W = (SW - H_PAD * 2 - CARD_GAP) / 2;

type ModuleKey = 'Lens' | 'Voice' | 'Scribe' | 'Deep' | 'Chat' | 'Nearby' | 'PeelFun';

interface Module {
  id: ModuleKey;
  screen: string;
  label: string;
  title: string;
  desc: string;
  icon: (color: string) => React.ReactNode;
  fullWidth?: boolean;
  beta?: boolean;         // true = dim + show Beta badge (coming soon)
  modelKey?: string;      // which model key this module needs
  requiresBoth?: boolean; // vision: requires main + mmproj
}

// 'any-text' means: any downloaded text model satisfies this module.
const TEXT_MODEL_KEY = 'any-text';

const MODULES: Module[] = [
  {
    id: 'Lens', screen: 'Lens', label: 'Vision AI', title: 'Peek Lens',
    desc: 'Scan food, labels & images — instant insights',
    icon: (c) => <IconLens size={20} color={c} />,
    modelKey: MODEL_KEYS.VISION,
    requiresBoth: true,
  },
  {
    id: 'Voice', screen: 'Voice', label: 'Whisper · Built-in', title: 'Peek Voice',
    desc: 'Record or upload audio — transcribe & summarize',
    icon: (c) => <IconVoice size={20} color={c} />,
  },
  {
    id: 'Scribe', screen: 'Scribe', label: 'AI Model', title: 'Peek Scribe',
    desc: 'Draft documents, meal plans, and notes',
    icon: (c) => <IconScribe size={20} color={c} />,
    modelKey: TEXT_MODEL_KEY,
  },
  {
    id: 'Deep', screen: 'Deep', label: 'AI Model', title: 'Peek Deep',
    desc: 'Research documents privately on-device',
    icon: (c) => <IconDeep size={20} color={c} />,
    modelKey: TEXT_MODEL_KEY,
  },
  {
    id: 'Chat', screen: 'AIChatHub', label: 'AI Model', title: 'AI Chat',
    desc: 'Ask anything — questions, explanations, code, ideas',
    icon: (c) => <IconChat size={20} color={c} />,
    modelKey: TEXT_MODEL_KEY,
  },
  {
    id: 'Nearby', screen: 'Nearby', label: 'OpenStreetMap', title: 'Map Search',
    desc: 'Find any place in the world — no location permission needed',
    icon: (c) => <IconNearby size={20} color={c} />,
    fullWidth: true,
  },
  {
    id: 'PeelFun', screen: 'PeelFun', label: 'Game', title: 'Peel Fun',
    desc: 'Tic-Tac-Toe vs AI — ask the model to play',
    icon: (c) => <IconGame size={20} color={c} />,
  },
];

type ModelStatus = 'ready' | 'needs-download' | 'unknown';

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const { open: openSidebar } = useSidebar();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const [downloadedModels, setDownloadedModels] = useState<DownloadedModel[]>([]);

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 380, useNativeDriver: true }).start();
  }, []);

  // Refresh model status every time screen focuses
  useFocusEffect(useCallback(() => {
    syncModelsFromDisk().then(models => {
      setDownloadedModels(models);
    }).catch(() => {});
  }, []));

  const hasAnyTextModel = (): boolean =>
    downloadedModels.some(m => m.modelType === 'text');

  const getStatus = (mod: Module): ModelStatus => {
    if (!mod.modelKey) return 'ready';
    if (mod.modelKey === TEXT_MODEL_KEY) {
      return hasAnyTextModel() ? 'ready' : 'needs-download';
    }
    const dm = downloadedModels.find(m => m.id === mod.modelKey);
    if (!dm) return 'needs-download';
    if (mod.requiresBoth && !dm.projectionModelSrc) return 'needs-download';
    return 'ready';
  };

  const enterModule = async (mod: Module) => {
    const status = getStatus(mod);
    if (status === 'needs-download') {
      const downloadId = mod.modelKey === TEXT_MODEL_KEY
        ? MODEL_KEYS.TEXT_HEALTH
        : mod.modelKey!;
      navigation.navigate('Download', {
        modelId: downloadId,
        returnTo: mod.screen,
        returnParams: {},
      });
      return;
    }
    navigation.navigate(mod.screen);
  };

  const grid = MODULES.filter(m => !m.fullWidth);
  const full = MODULES.filter(m => m.fullWidth);

  const statusBadge = (mod: Module) => {
    const s = getStatus(mod);
    if (s === 'needs-download') {
      return (
        <View style={[styles.statusPill, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
          <Text style={[styles.statusPillText, { color: theme.textSecondary }]}>Download</Text>
        </View>
      );
    }
    return (
      <View style={[styles.statusPill, { backgroundColor: theme.accent + '22', borderColor: theme.accent + '55' }]}>
        <View style={[styles.statusDot, { backgroundColor: theme.accent }]} />
        <Text style={[styles.statusPillText, { color: theme.accent }]}>Ready</Text>
      </View>
    );
  };

  return (
    <Animated.View style={[styles.root, { backgroundColor: theme.background, opacity: fadeAnim }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={openSidebar} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={styles.menuBtn}>
          <IconMenu size={20} color={theme.text} />
        </TouchableOpacity>
        <View style={styles.brand}>
          <View style={[styles.brandDot, { backgroundColor: theme.accent }]} />
          <Text style={[styles.brandName, { color: theme.text }]}>Peek</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      {/* Cards */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>All Modules</Text>

        {/* 2-col grid */}
        <View style={styles.grid}>
          {grid.map((mod) => (
            <TouchableOpacity
              key={mod.id}
              style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border, width: CARD_W }]}
              onPress={() => enterModule(mod)}
              activeOpacity={0.72}
            >
              <View style={[styles.cardIcon, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
                {mod.icon(theme.text)}
              </View>
              <Text style={[styles.cardMeta, { color: theme.textSecondary }]}>{mod.label}</Text>
              <Text style={[styles.cardTitle, { color: theme.text }]}>{mod.title}</Text>
              <Text style={[styles.cardDesc, { color: theme.textSecondary }]} numberOfLines={2}>{mod.desc}</Text>
              {mod.modelKey ? statusBadge(mod) : null}
            </TouchableOpacity>
          ))}
        </View>

        {/* Full-width cards */}
        {full.map((mod) => (
          <TouchableOpacity
            key={mod.id}
            style={[styles.cardFull, { backgroundColor: theme.card, borderColor: theme.border, opacity: mod.beta ? 0.45 : 1 }]}
            onPress={() => enterModule(mod)}
            activeOpacity={0.75}
          >
            <View style={[styles.cardIcon, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
              {mod.icon(theme.text)}
            </View>
            <View style={styles.cardFullBody}>
              <Text style={[styles.cardMeta, { color: theme.textSecondary }]}>{mod.label}</Text>
              <Text style={[styles.cardTitle, { color: theme.text }]}>{mod.title}</Text>
              <Text style={[styles.cardDesc, { color: theme.textSecondary }]} numberOfLines={1}>{mod.desc}</Text>
            </View>
            {mod.beta && (
              <View style={[styles.betaBadge, { borderColor: theme.accent + '44', backgroundColor: theme.accent + '18' }]}>
                <Text style={[styles.betaText, { color: theme.accent }]}>Beta</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}

        <View style={{ height: 32 }} />
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingHorizontal: 20, paddingBottom: 13, borderBottomWidth: 1,
  },
  menuBtn: { width: 36, height: 36, justifyContent: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brandDot: { width: 7, height: 7, borderRadius: 3.5 },
  brandName: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PAD, paddingTop: 0 },
  sectionLabel: {
    fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase',
    paddingVertical: 14, paddingHorizontal: 8,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: CARD_GAP },
  card: {
    borderRadius: 16, borderWidth: 1, padding: 14,
    gap: 6, minHeight: 145,
  },
  cardFull: {
    borderRadius: 16, borderWidth: 1, padding: 16,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    marginTop: CARD_GAP,
  },
  cardFullBody: { flex: 1, gap: 4 },
  cardIcon: {
    width: 40, height: 40, borderRadius: 12, borderWidth: 1,
    justifyContent: 'center', alignItems: 'center',
  },
  cardMeta: { fontSize: 10, fontWeight: '500' },
  cardTitle: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2, lineHeight: 18 },
  cardDesc: { fontSize: 12, lineHeight: 16 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', borderRadius: 20, borderWidth: 1,
    paddingHorizontal: 7, paddingVertical: 3, marginTop: 2,
  },
  statusDot: { width: 5, height: 5, borderRadius: 2.5 },
  statusPillText: { fontSize: 9, fontWeight: '600', letterSpacing: 0.3 },
  betaBadge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  betaText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
});
