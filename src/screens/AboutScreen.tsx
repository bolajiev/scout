import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { IconBack, IconBall, IconTarget, IconCamera, IconFanRoom } from '../components/Icons';

const appVersion = Constants.expoConfig?.version ?? '1.0';

const MODULES = [
  {
    icon: (c: string) => <IconBall size={18} color={c} />,
    tag: 'QVAC',
    tagColor: '#22c55e',
    title: 'AI Coach',
    desc: 'Ask anything about football — tactics, formations, players, clubs, and tournaments. Fully on-device, no internet.',
  },
  {
    icon: (c: string) => <IconTarget size={18} color={c} />,
    tag: 'QVAC',
    tagColor: '#22c55e',
    title: 'Predictor',
    desc: 'Pick two teams and generate an on-device AI match prediction with score, reasoning, and confidence level.',
  },
  {
    icon: (c: string) => <IconCamera size={18} color={c} />,
    tag: 'QVAC Vision',
    tagColor: '#22c55e',
    title: 'Scout Lens',
    desc: 'Point your camera at any football image — jersey, club badge, player card, scoreboard — and get instant on-device identification.',
  },
  {
    icon: (c: string) => <IconFanRoom size={18} color={c} />,
    tag: 'Pears P2P',
    tagColor: '#60a5fa',
    title: 'Fan Room',
    desc: 'Device-to-device fan chat powered by Holepunch. No server, no account, no internet. Works in the stadium.',
  },
];

export default function AboutScreen() {
  const navigation = useNavigation<any>();
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, []);

  const accent = theme.accent;

  return (
    <Animated.View style={[styles.root, { backgroundColor: theme.background, opacity: fadeAnim }]}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <IconBack size={18} color={accent} />
        </TouchableOpacity>
        <View style={styles.brand}>
          <View style={[styles.brandDot, { backgroundColor: accent }]} />
          <Text style={[styles.brandName, { color: theme.text }]}>Scout</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={[styles.logoMark, { backgroundColor: accent }]}>
            <Text style={styles.logoLetter}>S</Text>
          </View>
          <Text style={[styles.appName, { color: theme.text }]}>Scout</Text>
          <Text style={[styles.tagline, { color: theme.textSecondary }]}>On-Device Football AI</Text>
          <View style={styles.badgeRow}>
            {['Private', 'On-Device', 'No Cloud'].map(b => (
              <View key={b} style={[styles.badge, { backgroundColor: accent + '18', borderColor: accent + '40' }]}>
                <Text style={[styles.badgeText, { color: accent }]}>{b}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* About */}
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>What is Scout?</Text>
          <Text style={[styles.cardBody, { color: theme.textSecondary }]}>
            Scout is an on-device football AI built for the Tether Developers Cup 2026. All inference runs locally via the QVAC SDK — no data leaves your phone. Modules: AI Coach, Predictor, Scout Lens, and Fan Room (Pears P2P).
          </Text>
        </View>

        {/* Modules */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Modules</Text>
        {MODULES.map((m, i) => (
          <View key={m.title} style={[styles.featureRow, { borderColor: theme.border, borderBottomWidth: i < MODULES.length - 1 ? 1 : 0 }]}>
            <View style={[styles.featureIconBox, { backgroundColor: m.tagColor + '18' }]}>
              {m.icon(m.tagColor)}
            </View>
            <View style={styles.featureBody}>
              <View style={styles.featureTitleRow}>
                <Text style={[styles.featureTitle, { color: theme.text }]}>{m.title}</Text>
                <View style={[styles.featureTag, { backgroundColor: m.tagColor + '18', borderColor: m.tagColor + '40' }]}>
                  <Text style={[styles.featureTagText, { color: m.tagColor }]}>{m.tag}</Text>
                </View>
              </View>
              <Text style={[styles.featureDesc, { color: theme.textSecondary }]}>{m.desc}</Text>
            </View>
          </View>
        ))}

        {/* Privacy */}
        <View style={[styles.privacyCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={[styles.privacyBar, { backgroundColor: accent }]} />
          <Text style={[styles.privacyText, { color: theme.textSecondary }]}>
            All AI inference runs on your device via the QVAC SDK. Your photos, messages, and conversations never leave your phone — no servers, no telemetry, no accounts required.
          </Text>
        </View>

        {/* Tech */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary, marginTop: 8 }]}>Built with</Text>
        <View style={[styles.techCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          {[
            { name: 'QVAC SDK', note: 'On-device LLM inference — all AI runs locally' },
            { name: 'Pears / Holepunch', note: 'P2P Fan Room network layer' },
            { name: 'Expo SDK 54', note: 'React Native framework' },
          ].map((t, i) => (
            <View key={t.name} style={[styles.techRow, { borderTopWidth: i > 0 ? 1 : 0, borderTopColor: theme.border }]}>
              <Text style={[styles.techName, { color: theme.text }]}>{t.name}</Text>
              <Text style={[styles.techNote, { color: theme.textSecondary }]}>{t.note}</Text>
            </View>
          ))}
        </View>

        {/* Third-party disclosures */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary, marginTop: 8 }]}>Third-party disclosures</Text>
        <View style={[styles.techCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          {[
            { name: 'TheSportsDB', note: 'Fixture data for Predictor · thesportsdb.com · Free public API · No account required' },
            { name: 'Gemma 4 E2B', note: 'Google model weights via HuggingFace (bartowski/google_gemma-4-E2B-it-GGUF)' },
            { name: 'Qwen3 1.7B', note: 'Alibaba model weights via QVAC SDK registry' },
            { name: 'MedPsy 1.7B / 4B', note: 'QVAC model weights — inference on-device only' },
          ].map((t, i) => (
            <View key={t.name} style={[styles.techRow, { borderTopWidth: i > 0 ? 1 : 0, borderTopColor: theme.border }]}>
              <Text style={[styles.techName, { color: theme.text }]}>{t.name}</Text>
              <Text style={[styles.techNote, { color: theme.textSecondary }]}>{t.note}</Text>
            </View>
          ))}
        </View>

        <Text style={[styles.version, { color: theme.textSecondary }]}>
          {`Scout v${appVersion} · QVAC SDK · Pears · On-Device Football AI`}
        </Text>
        <View style={{ height: 40 }} />
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
  brand: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brandDot: { width: 7, height: 7, borderRadius: 3.5 },
  brandName: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 28 },
  hero: { alignItems: 'center', gap: 8, marginBottom: 28 },
  logoMark: { width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  logoLetter: { fontSize: 40, fontWeight: '900', color: '#fff', letterSpacing: -1 },
  appName: { fontSize: 34, fontWeight: '900', letterSpacing: -1, marginTop: 4 },
  tagline: { fontSize: 14 },
  badgeRow: { flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center' },
  badge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 20, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  cardBody: { fontSize: 14, lineHeight: 21 },
  sectionLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1.2,
    textTransform: 'uppercase', marginBottom: 10,
  },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 14 },
  featureIconBox: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  featureBody: { flex: 1, gap: 4 },
  featureTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  featureTitle: { fontSize: 14, fontWeight: '700' },
  featureTag: { borderWidth: 1, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  featureTagText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
  featureDesc: { fontSize: 13, lineHeight: 19 },
  privacyCard: {
    borderRadius: 14, borderWidth: 1, flexDirection: 'row',
    overflow: 'hidden', marginBottom: 20, marginTop: 8,
  },
  privacyBar: { width: 4 },
  privacyText: { flex: 1, fontSize: 13, lineHeight: 19, padding: 14 },
  techCard: { borderRadius: 14, borderWidth: 1, marginBottom: 20, overflow: 'hidden' },
  techRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 14 },
  techName: { fontSize: 14, fontWeight: '700' },
  techNote: { fontSize: 13 },
  version: { fontSize: 11, textAlign: 'center', marginBottom: 8 },
});
