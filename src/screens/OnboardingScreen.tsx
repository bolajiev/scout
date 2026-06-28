import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Dimensions, Image, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { markOnboarded } from '../utils/storage';

const { width: SW } = Dimensions.get('window');

const MODULES = [
  { label: 'Lens', title: 'Peek Lens', desc: 'Scan food, labels, and images for instant AI insights' },
  { label: 'Voice', title: 'Peek Voice', desc: 'Transcribe and summarize any audio, on-device' },
  { label: 'Scribe', title: 'Peek Scribe', desc: 'Draft documents, notes, and meal plans with AI' },
  { label: 'Deep', title: 'Peek Deep', desc: 'Upload files and ask questions privately' },
  { label: 'Chat', title: 'AI Chat', desc: 'Full conversations with maps and tool support' },
  { label: 'Map', title: 'Map Search', desc: 'Find any place in the world — no GPS needed' },
  { label: 'Game', title: 'Peel Fun', desc: 'Tic-Tac-Toe against the on-device AI' },
];

export default function OnboardingScreen() {
  const navigation = useNavigation<any>();
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const btnScale = useRef(new Animated.Value(1)).current;

  const goNext = () => {
    const next = page + 1;
    scrollRef.current?.scrollTo({ x: SW * next, animated: true });
    setPage(next);
  };

  const handleGetStarted = async () => {
    Animated.sequence([
      Animated.timing(btnScale, { toValue: 0.96, duration: 80, useNativeDriver: true }),
      Animated.timing(btnScale, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start();
    await markOnboarded();
    navigation.replace('Main');
  };

  const onScroll = (e: any) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SW);
    if (idx !== page) setPage(idx);
  };

  const topPad = Math.max(insets.top, 32);
  const botPad = Math.max(insets.bottom, 20);

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
        style={styles.pager}
        bounces={false}
      >
        {/* Slide 1 — Welcome */}
        <View style={[styles.slide, { paddingTop: topPad }]}>
          <View style={styles.centerCol}>
            <Image source={require('../../peeklogo.png')} style={styles.logo} resizeMode="contain" />
            <Text style={[styles.appName, { color: theme.accent }]}>Peek</Text>
            <Text style={[styles.tagline, { color: theme.text }]}>AI that runs on your phone.</Text>
            <Text style={[styles.sub, { color: theme.textSecondary }]}>Private · Offline · No Cloud</Text>
            <View style={[styles.versionBadge, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Text style={[styles.versionBadgeText, { color: theme.accent }]}>v1.1 — Map, Game + Voice updates</Text>
            </View>
          </View>
        </View>

        {/* Slide 2 — All modules */}
        <View style={[styles.slide, { paddingTop: topPad }]}>
          <Text style={[styles.slideTitle, { color: theme.text }]}>Everything in Peek</Text>
          <Text style={[styles.slideSub, { color: theme.textSecondary }]}>
            Seven tools, all on your device
          </Text>
          <ScrollView style={styles.moduleScroll} showsVerticalScrollIndicator={false}>
            {MODULES.map(m => (
              <View key={m.label} style={[styles.moduleRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <View style={[styles.moduleTag, { backgroundColor: theme.accent + '1A', borderColor: theme.accent + '40' }]}>
                  <Text style={[styles.moduleTagText, { color: theme.accent }]}>{m.label}</Text>
                </View>
                <View style={styles.moduleBody}>
                  <Text style={[styles.moduleTitle, { color: theme.text }]}>{m.title}</Text>
                  <Text style={[styles.moduleDesc, { color: theme.textSecondary }]}>{m.desc}</Text>
                </View>
              </View>
            ))}
            <View style={{ height: 16 }} />
          </ScrollView>
        </View>

        {/* Slide 3 — Privacy + MedPsy */}
        <View style={[styles.slide, { paddingTop: topPad }]}>
          <View style={styles.centerCol}>
            <Text style={[styles.slideTitle, { color: theme.text }]}>Private by design</Text>
            <Text style={[styles.privacyLine, { color: theme.textSecondary }]}>
              No cloud. No tracking.{'\n'}Nothing ever leaves your phone.
            </Text>

            <View style={[styles.infoCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Text style={[styles.infoCardTitle, { color: theme.text }]}>Your AI model: MedPsy 1.7B</Text>
              <Text style={[styles.infoCardBody, { color: theme.textSecondary }]}>
                Peek uses MedPsy 1.7B by default — a lightweight medical and general AI model built for on-device use. Download it once, free, and it runs fully offline. You can switch models anytime in Settings.
              </Text>
            </View>

            <View style={[styles.mapNote, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
              <Text style={[styles.mapNoteText, { color: theme.textSecondary }]}>
                Map Search uses Google Maps for location lookup — your search query is sent to Google but no GPS data is collected from your device.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: botPad, borderTopColor: theme.border }]}>
        <View style={styles.dots}>
          {[0, 1, 2].map(i => (
            <View
              key={i}
              style={[
                styles.dot,
                i === page
                  ? { backgroundColor: theme.accent, width: 20 }
                  : { backgroundColor: theme.border, width: 7 },
              ]}
            />
          ))}
        </View>
        <Animated.View style={{ transform: [{ scale: btnScale }] }}>
          {page < 2 ? (
            <TouchableOpacity style={[styles.btn, { backgroundColor: theme.accent }]} onPress={goNext} activeOpacity={0.88}>
              <Text style={[styles.btnText, { color: theme.accentFg }]}>Next →</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.btn, { backgroundColor: theme.accent }]} onPress={handleGetStarted} activeOpacity={0.88}>
              <Text style={[styles.btnText, { color: theme.accentFg }]}>Get Started →</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pager: { flex: 1 },
  slide: { width: SW, flex: 1, paddingHorizontal: 28 },
  centerCol: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },

  // Slide 1
  logo: { width: 88, height: 88, borderRadius: 22 },
  appName: { fontSize: 56, fontWeight: '900', letterSpacing: 2, marginTop: 4 },
  tagline: { fontSize: 21, fontWeight: '700', textAlign: 'center', letterSpacing: -0.3 },
  sub: { fontSize: 14, fontWeight: '500', textAlign: 'center', letterSpacing: 0.8 },
  versionBadge: {
    marginTop: 8, paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1,
  },
  versionBadgeText: { fontSize: 13, fontWeight: '600' },

  // Slide 2
  slideTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center', marginBottom: 4 },
  slideSub: { fontSize: 13, textAlign: 'center', marginBottom: 16 },
  moduleScroll: { flex: 1 },
  moduleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 8,
  },
  moduleTag: {
    borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3,
    minWidth: 40, alignItems: 'center',
  },
  moduleTagText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },
  moduleBody: { flex: 1 },
  moduleTitle: { fontSize: 14, fontWeight: '700' },
  moduleDesc: { fontSize: 12, lineHeight: 17, marginTop: 2 },

  // Slide 3
  privacyLine: { fontSize: 16, lineHeight: 25, textAlign: 'center', fontWeight: '500' },
  infoCard: { borderRadius: 14, borderWidth: 1, padding: 16, width: '100%', gap: 8 },
  infoCardTitle: { fontSize: 14, fontWeight: '700' },
  infoCardBody: { fontSize: 13, lineHeight: 19 },
  mapNote: { borderRadius: 12, borderWidth: 1, padding: 14, width: '100%' },
  mapNoteText: { fontSize: 12, lineHeight: 18, textAlign: 'center' },

  // Footer
  footer: { paddingHorizontal: 24, paddingTop: 16, gap: 16, borderTopWidth: StyleSheet.hairlineWidth },
  dots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  dot: { height: 7, borderRadius: 4 },
  btn: { borderRadius: 16, paddingVertical: 18, alignItems: 'center' },
  btnText: { fontSize: 17, fontWeight: '800', letterSpacing: 0.3 },
});
