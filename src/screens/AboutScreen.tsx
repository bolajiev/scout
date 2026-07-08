import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, ScrollView, TouchableOpacity, Linking, Image } from 'react-native';
import Constants from 'expo-constants';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { IconBall, IconTarget, IconCalendar } from '../components/Icons';
import ScreenHeader from '../components/ScreenHeader';

const appVersion = Constants.expoConfig?.version ?? '1.0';
const buildNumber = Constants.expoConfig?.extra?.buildNumber ?? '0';
const buildHash = Constants.expoConfig?.extra?.buildHash ?? 'unknown';
const buildDate = Constants.expoConfig?.extra?.buildDate ?? '';
const REPO_URL = 'https://github.com/bolajiev/scout';

const MODULES = [
  {
    icon: (c: string) => <IconBall size={18} color={c} />,
    tag: 'TOOL CALLING',
    tagColor: '#C6F53A',
    title: 'AI Coach',
    desc: 'On-device LLM with tool calling: the model decides when to fetch today\'s fixtures or a team\'s recent form — every fetch is disclosed and viewable. Attach a photo for on-device vision identification. Streams its thinking process in Think mode.',
  },
  {
    icon: (c: string) => <IconTarget size={18} color={c} />,
    tag: 'ACCOUNTABLE',
    tagColor: '#C6F53A',
    title: 'Predictor',
    desc: 'Structured on-device predictions fed with real team form. Every call is recorded and graded against the real result — the app keeps a public W/L track record of its own AI.',
  },
  {
    icon: (c: string) => <IconCalendar size={18} color={c} />,
    tag: 'MATCHDAY',
    tagColor: '#C6F53A',
    title: 'Matches',
    desc: 'World Cup 2026 and top-league fixtures with live scores and team badges, merged from several football data sources and cached locally — readable offline after one sync.',
  },
];

export default function AboutScreen() {
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, []);

  const accent = theme.accent;

  return (
    <Animated.View style={[styles.root, { backgroundColor: theme.background, opacity: fadeAnim }]}>
      <ScreenHeader title="About" />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.logoMark}>
            <Image source={require('../../assets/icon.png')} style={styles.logoImage} resizeMode="cover" />
          </View>
          <Text style={[styles.appName, { color: theme.text }]}>Scout</Text>
          <Text style={[styles.tagline, { color: theme.textSecondary }]}>On-Device Football AI</Text>
          <View style={styles.badgeRow}>
            {['Private', 'On-Device', 'No Cloud'].map(b => (
              <View key={b} style={[styles.badge, { backgroundColor: accent + '18' }]}>
                <Text style={[styles.badgeText, { color: accent }]}>{b}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* About */}
        <View style={[styles.card, { backgroundColor: theme.card }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>What is Scout?</Text>
          <Text style={[styles.cardBody, { color: theme.textSecondary }]}>
            A complete football companion where every AI feature — chat and match prediction — runs 100% on your phone through the QVAC SDK. No cloud AI, no accounts; the model never leaves your device. Fixtures, team form, and news still need a connection to fetch, then stay readable offline. Built for the FIFA World Cup 2026 moment: matchday fixtures and form-grounded predictions with a real track record.
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
                <View style={[styles.featureTag, { backgroundColor: m.tagColor + '20' }]}>
                  <Text style={[styles.featureTagText, { color: m.tagColor }]}>{m.tag}</Text>
                </View>
              </View>
              <Text style={[styles.featureDesc, { color: theme.textSecondary }]}>{m.desc}</Text>
            </View>
          </View>
        ))}

        {/* Privacy */}
        <View style={[styles.privacyCard, { backgroundColor: theme.card }]}>
          <View style={[styles.privacyBar, { backgroundColor: accent }]} />
          <Text style={[styles.privacyText, { color: theme.textSecondary }]}>
            All AI inference runs on your device via the QVAC SDK. Your photos, messages, and conversations never leave your phone — no servers, no telemetry, no accounts required.
          </Text>
        </View>

        {/* Tech */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary, marginTop: 8 }]}>Built with</Text>
        <View style={[styles.techCard, { backgroundColor: theme.card }]}>
          {[
            { name: 'QVAC SDK', note: 'All inference on-device: LLM, tool calling, streaming' },
            { name: 'Custom QVAC worker', note: 'Rebuilt LLM-only: 918 MB of native engines trimmed to 145 MB' },
            { name: 'Text models', note: 'Qwen3, QVAC MedPsy — 390 MB to 2.7 GB tiers' },
            { name: 'Vision models', note: 'Gemma 4, SmolVLM2 — downloadable, not yet wired into any screen' },
            { name: 'Match data', note: 'Bzzoiro Sports (default key) + football-data.org + TheSportsDB, merged' },
            { name: 'Expo SDK 54', note: 'React Native, Android arm64' },
          ].map((t, i) => (
            <View key={t.name} style={[styles.techRow, { borderTopWidth: i > 0 ? 1 : 0, borderTopColor: theme.border }]}>
              <Text style={[styles.techName, { color: theme.text }]}>{t.name}</Text>
              <Text style={[styles.techNote, { color: theme.textSecondary }]}>{t.note}</Text>
            </View>
          ))}
        </View>

        {/* Third-party disclosures */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary, marginTop: 8 }]}>Third-party disclosures</Text>
        <View style={[styles.techCard, { backgroundColor: theme.card }]}>
          {[
            { name: 'Bzzoiro Sports', note: 'Live scores, fixtures, form & player ratings · sports.bzzoiro.com · Data lookup only, not AI' },
            { name: 'football-data.org', note: 'Fixtures & form (optional user key) · Data lookup only, not AI' },
            { name: 'TheSportsDB', note: 'Fixture and form data · thesportsdb.com · Free public API · No account required' },
            { name: 'Qwen3 0.6B / 1.7B', note: 'Alibaba model weights via QVAC SDK registry' },
            { name: 'MedPsy 1.7B / 4B', note: 'QVAC model weights — inference on-device only' },
            { name: 'Gemma 4 E2B, SmolVLM2', note: 'Vision model weights — power photo uploads in AI Coach' },
          ].map((t, i) => (
            <View key={t.name} style={[styles.techRow, { borderTopWidth: i > 0 ? 1 : 0, borderTopColor: theme.border }]}>
              <Text style={[styles.techName, { color: theme.text }]}>{t.name}</Text>
              <Text style={[styles.techNote, { color: theme.textSecondary }]}>{t.note}</Text>
            </View>
          ))}
        </View>

        {/* Source & updates */}
        <TouchableOpacity
          style={[styles.updateBtn, { backgroundColor: theme.card }]}
          onPress={() => Linking.openURL(`${REPO_URL}/releases/latest`)}
          activeOpacity={0.75}
        >
          <Text style={[styles.updateBtnText, { color: theme.text }]}>Check for updates</Text>
          <Text style={[styles.updateBtnSub, { color: theme.textSecondary }]}>Latest release on GitHub →</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => Linking.openURL(REPO_URL)} activeOpacity={0.7}>
          <Text style={[styles.repoLink, { color: accent }]}>View source on GitHub</Text>
        </TouchableOpacity>

        <Text style={[styles.version, { color: theme.textSecondary }]}>
          {`Scout v${appVersion} · Build ${buildNumber} (${buildHash})${buildDate ? ` · ${buildDate}` : ''}`}
        </Text>
        <View style={{ height: 40 }} />
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 28 },
  hero: { alignItems: 'center', gap: 8, marginBottom: 28 },
  logoMark: {
    width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff', overflow: 'hidden',
  },
  logoImage: { width: 72, height: 72 },
  appName: { fontSize: 34, fontWeight: '900', letterSpacing: -1, marginTop: 4 },
  tagline: { fontSize: 14 },
  badgeRow: { flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center' },
  badge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  card: { borderRadius: 14, padding: 16, marginBottom: 20, gap: 8 },
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
  featureTag: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  featureTagText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
  featureDesc: { fontSize: 13, lineHeight: 19 },
  privacyCard: {
    borderRadius: 14, flexDirection: 'row',
    overflow: 'hidden', marginBottom: 20, marginTop: 8,
  },
  privacyBar: { width: 4 },
  privacyText: { flex: 1, fontSize: 13, lineHeight: 19, padding: 14 },
  techCard: { borderRadius: 14, marginBottom: 20, overflow: 'hidden' },
  // BUG FIX: was flexDirection: 'row' with two unconstrained Text
  // children — a long note (most of these are full sentences, not short
  // labels) had nothing to wrap against and just ran off the right edge
  // of the screen instead. Stacked layout wraps normally at any width.
  techRow: { padding: 14, gap: 3 },
  techName: { fontSize: 14, fontWeight: '700' },
  techNote: { fontSize: 13, lineHeight: 18 },
  updateBtn: { borderRadius: 14, padding: 14, alignItems: 'center', marginBottom: 12, gap: 3 },
  updateBtnText: { fontSize: 14, fontWeight: '700' },
  updateBtnSub: { fontSize: 12 },
  repoLink: { fontSize: 13, fontWeight: '600', textAlign: 'center', marginBottom: 20 },
  version: { fontSize: 11, textAlign: 'center', marginBottom: 8 },
});
