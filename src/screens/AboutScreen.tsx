import React, { useRef, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, ScrollView, Linking, Image, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { IconBack } from '../components/Icons';

const DOWNLOAD_URL = 'https://linktr.ee/peekapp';
const appVersion = Constants.expoConfig?.version ?? '1.0';

const FEATURES = [
  { tag: 'Lens', title: 'Peek Lens', desc: 'Point your camera at anything — food labels, documents, or objects — and get instant on-device analysis.' },
  { tag: 'Voice', title: 'Peek Voice', desc: 'Record or upload audio and get live transcriptions with AI-generated summaries, all processed on-device.' },
  { tag: 'Scribe', title: 'Peek Scribe', desc: 'Draft documents, meal plans, reports, and notes. Export as markdown or HTML — all generated on your phone.' },
  { tag: 'Deep', title: 'Peek Deep', desc: 'Upload files and ask detailed questions about their content. Private research without the cloud.' },
  { tag: 'Chat', title: 'AI Chat', desc: 'Full conversations with an on-device model. Supports inline maps — ask about any location and a map appears in the chat.' },
  { tag: 'Map', title: 'Map Search', desc: 'Search any place in the world. Uses Google Maps embed — no GPS required. A privacy notice appears before every use.' },
  { tag: 'Game', title: 'Peel Fun', desc: 'Tic-Tac-Toe against the on-device AI. Easy mode uses the language model directly. Hard mode uses minimax algorithm.' },
];

export default function AboutScreen() {
  const navigation = useNavigation<any>();
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, []);

  const handleCheckUpdates = async () => {
    setChecking(true);
    try {
      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        Alert.alert('Update Available', 'A new version of Peek is ready.', [
          { text: 'Later', style: 'cancel' },
          { text: 'Install', onPress: async () => {
            await Updates.fetchUpdateAsync();
            await Updates.reloadAsync();
          }},
        ]);
      } else {
        Alert.alert('Up to Date', 'You have the latest version of Peek.');
      }
    } catch {
      Linking.openURL(DOWNLOAD_URL);
    } finally {
      setChecking(false);
    }
  };

  return (
    <Animated.View style={[styles.root, { backgroundColor: theme.background, opacity: fadeAnim }]}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <IconBack size={18} color={theme.accent} />
        </TouchableOpacity>
        <View style={styles.brand}>
          <View style={[styles.brandDot, { backgroundColor: theme.accent }]} />
          <Text style={[styles.brandName, { color: theme.text }]}>Peek</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.hero}>
          <Image source={require('../../peeklogo.png')} style={styles.logo} />
          <Text style={[styles.appName, { color: theme.text }]}>Peek</Text>
          <Text style={[styles.tagline, { color: theme.textSecondary }]}>Private AI that runs on your phone.</Text>
          <View style={styles.badgeRow}>
            {['Private', 'On-Device', 'No Cloud'].map(b => (
              <View key={b} style={[styles.badge, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
                <Text style={[styles.badgeText, { color: theme.textSecondary }]}>{b}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* About */}
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>What is Peek?</Text>
          <Text style={[styles.cardBody, { color: theme.textSecondary }]}>
            Peek is a fully private AI assistant powered by the QVAC SDK. Models run entirely on your device — no data collection, no subscriptions, no cloud. Seven modules: Lens, Voice, Scribe, Deep Research, AI Chat, Map Search, and Peel Fun. Default model: MedPsy 1.7B.
          </Text>
        </View>

        {/* Features */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Modules</Text>
        {FEATURES.map((f, i) => (
          <View key={f.tag} style={[styles.featureRow, { borderColor: theme.border, borderBottomWidth: i < FEATURES.length - 1 ? 1 : 0 }]}>
            <View style={[styles.featureTag, { backgroundColor: theme.accent + '18', borderColor: theme.accent + '44' }]}>
              <Text style={[styles.featureTagText, { color: theme.accent }]}>{f.tag}</Text>
            </View>
            <View style={styles.featureBody}>
              <Text style={[styles.featureTitle, { color: theme.text }]}>{f.title}</Text>
              <Text style={[styles.featureDesc, { color: theme.textSecondary }]}>{f.desc}</Text>
            </View>
          </View>
        ))}

        {/* Privacy */}
        <View style={[styles.privacyCard, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
          <View style={[styles.privacyDot, { backgroundColor: theme.accent }]} />
          <Text style={[styles.privacyText, { color: theme.textSecondary }]}>
            All AI inference runs on your device via the QVAC SDK. Your photos, audio, documents, and conversations never leave your phone — no servers, no telemetry, no accounts.
          </Text>
        </View>

        {/* Update */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary, marginTop: 8 }]}>Updates</Text>
        <TouchableOpacity
          style={[styles.downloadBtn, { backgroundColor: theme.accent, opacity: checking ? 0.7 : 1 }]}
          onPress={handleCheckUpdates}
          activeOpacity={0.85}
          disabled={checking}
        >
          <Text style={[styles.downloadBtnText, { color: theme.accentFg }]}>
            {checking ? 'Checking…' : 'Check for Updates'}
          </Text>
        </TouchableOpacity>
        <Text style={[styles.urlHint, { color: theme.textSecondary }]}>{DOWNLOAD_URL}</Text>

        <Text style={[styles.version, { color: theme.textSecondary }]}>{`Peek v${appVersion} · QVAC SDK · On-Device AI · MedPsy 1.7B default`}</Text>
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
  hero: { alignItems: 'center', gap: 6, marginBottom: 28 },
  logo: { width: 72, height: 72, borderRadius: 20, marginBottom: 8 },
  appName: { fontSize: 34, fontWeight: '900', letterSpacing: -1 },
  tagline: { fontSize: 15 },
  badgeRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  badge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 20, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  cardBody: { fontSize: 14, lineHeight: 21 },
  sectionLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1.2,
    textTransform: 'uppercase', marginBottom: 10,
  },
  featureRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 14,
  },
  featureTag: {
    borderWidth: 1, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4,
    alignSelf: 'flex-start', minWidth: 48, alignItems: 'center',
  },
  featureTagText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  featureBody: { flex: 1, gap: 3 },
  featureTitle: { fontSize: 14, fontWeight: '700' },
  featureDesc: { fontSize: 13, lineHeight: 19 },
  privacyCard: {
    borderRadius: 14, borderWidth: 1, padding: 16,
    flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 20, marginTop: 8,
  },
  privacyDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5, flexShrink: 0 },
  privacyText: { flex: 1, fontSize: 13, lineHeight: 19 },
  downloadBtn: {
    borderRadius: 16, paddingVertical: 17, alignItems: 'center', marginBottom: 8, marginTop: 4,
  },
  downloadBtnText: { fontSize: 16, fontWeight: '800' },
  urlHint: { fontSize: 11, textAlign: 'center', marginBottom: 20 },
  version: { fontSize: 11, textAlign: 'center', marginBottom: 8 },
});
