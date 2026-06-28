import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Dimensions, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { markOnboarded } from '../utils/storage';
import { IconBall, IconTarget, IconCamera, IconFanRoom } from '../components/Icons';

const { width: SW } = Dimensions.get('window');

const MODULES = [
  {
    icon: (c: string) => <IconBall size={28} color={c} />,
    tag: 'QVAC',
    tagColor: '#22c55e',
    title: 'AI Coach',
    desc: 'Ask any football question — tactics, players, clubs, history. Runs 100% on-device.',
  },
  {
    icon: (c: string) => <IconTarget size={28} color={c} />,
    tag: 'QVAC',
    tagColor: '#22c55e',
    title: 'Predictor',
    desc: 'Pick two teams and get an on-device match prediction with reasoning.',
  },
  {
    icon: (c: string) => <IconCamera size={28} color={c} />,
    tag: 'QVAC Vision',
    tagColor: '#22c55e',
    title: 'Scout Lens',
    desc: 'Point your camera at a jersey, badge, or match screen. AI identifies it instantly.',
  },
  {
    icon: (c: string) => <IconFanRoom size={28} color={c} />,
    tag: 'Pears P2P',
    tagColor: '#60a5fa',
    title: 'Fan Room',
    desc: 'Chat with fans nearby — device-to-device. No server, no account. Works offline in the stadium.',
  },
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
  const accent = theme.accent;

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
            <View style={[styles.logoMark, { backgroundColor: accent }]}>
              <Text style={styles.logoLetter}>S</Text>
            </View>
            <Text style={[styles.wordmark, { color: theme.text }]}>SCOUT</Text>
            <Text style={[styles.tagline, { color: theme.textSecondary }]}>Your on-device football AI.</Text>
            <View style={[styles.pillRow]}>
              {['Private', 'Offline', 'No Cloud'].map(b => (
                <View key={b} style={[styles.pill, { backgroundColor: accent + '18', borderColor: accent + '44' }]}>
                  <Text style={[styles.pillText, { color: accent }]}>{b}</Text>
                </View>
              ))}
            </View>
            <View style={[styles.hackBadge, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={[styles.hackDot, { backgroundColor: accent }]} />
              <Text style={[styles.hackText, { color: theme.textSecondary }]}>Tether Developers Cup 2026</Text>
            </View>
          </View>
        </View>

        {/* Slide 2 — Modules */}
        <View style={[styles.slide, { paddingTop: topPad }]}>
          <Text style={[styles.slideTitle, { color: theme.text }]}>Four modules.</Text>
          <Text style={[styles.slideSub, { color: theme.textSecondary }]}>All running on your phone.</Text>
          <ScrollView style={styles.moduleScroll} showsVerticalScrollIndicator={false}>
            {MODULES.map(m => (
              <View key={m.title} style={[styles.moduleRow, { backgroundColor: theme.card, borderColor: m.tagColor + '40' }]}>
                <View style={[styles.moduleIconBox, { backgroundColor: m.tagColor + '18' }]}>
                  {m.icon(m.tagColor)}
                </View>
                <View style={styles.moduleBody}>
                  <View style={styles.moduleTitleRow}>
                    <Text style={[styles.moduleTitle, { color: theme.text }]}>{m.title}</Text>
                    <View style={[styles.moduleTag, { backgroundColor: m.tagColor + '18', borderColor: m.tagColor + '44' }]}>
                      <Text style={[styles.moduleTagText, { color: m.tagColor }]}>{m.tag}</Text>
                    </View>
                  </View>
                  <Text style={[styles.moduleDesc, { color: theme.textSecondary }]}>{m.desc}</Text>
                </View>
              </View>
            ))}
            <View style={{ height: 24 }} />
          </ScrollView>
        </View>

        {/* Slide 3 — Privacy */}
        <View style={[styles.slide, { paddingTop: topPad }]}>
          <View style={styles.centerCol}>
            <Text style={[styles.slideTitle, { color: theme.text }]}>Private by design.</Text>
            <Text style={[styles.privacyLine, { color: theme.textSecondary }]}>
              No cloud. No tracking.{'\n'}Nothing leaves your phone.
            </Text>

            <View style={[styles.infoCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={[styles.infoBar, { backgroundColor: accent }]} />
              <View style={styles.infoCardContent}>
                <Text style={[styles.infoCardTitle, { color: theme.text }]}>On-device inference</Text>
                <Text style={[styles.infoCardBody, { color: theme.textSecondary }]}>
                  Scout uses the QVAC SDK. AI runs entirely on your device — download a model once and it works fully offline. No API keys, no subscriptions.
                </Text>
              </View>
            </View>

            <View style={[styles.infoCard, { backgroundColor: theme.card, borderColor: '#60a5fa40' }]}>
              <View style={[styles.infoBar, { backgroundColor: '#60a5fa' }]} />
              <View style={styles.infoCardContent}>
                <Text style={[styles.infoCardTitle, { color: theme.text }]}>Fan Room uses Pears P2P</Text>
                <Text style={[styles.infoCardBody, { color: theme.textSecondary }]}>
                  Fan Room connects devices directly via Holepunch. No server, no account. Works offline in the stadium.
                </Text>
              </View>
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
                  ? { backgroundColor: accent, width: 20 }
                  : { backgroundColor: theme.border, width: 7 },
              ]}
            />
          ))}
        </View>
        <Animated.View style={{ transform: [{ scale: btnScale }] }}>
          {page < 2 ? (
            <TouchableOpacity style={[styles.btn, { backgroundColor: accent }]} onPress={goNext} activeOpacity={0.88}>
              <Text style={[styles.btnText, { color: theme.accentFg }]}>Next</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.btn, { backgroundColor: accent }]} onPress={handleGetStarted} activeOpacity={0.88}>
              <Text style={[styles.btnText, { color: theme.accentFg }]}>Get Started</Text>
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
  slide: { width: SW, flex: 1, paddingHorizontal: 24 },
  centerCol: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },

  logoMark: { width: 80, height: 80, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  logoLetter: { fontSize: 44, fontWeight: '900', color: '#fff', letterSpacing: -1 },
  wordmark: { fontSize: 40, fontWeight: '900', letterSpacing: 6 },
  tagline: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  pill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  pillText: { fontSize: 12, fontWeight: '700' },
  hackBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, marginTop: 4,
  },
  hackDot: { width: 6, height: 6, borderRadius: 3 },
  hackText: { fontSize: 12, fontWeight: '600' },

  slideTitle: { fontSize: 28, fontWeight: '900', letterSpacing: -0.5, textAlign: 'center', marginBottom: 2 },
  slideSub: { fontSize: 14, textAlign: 'center', marginBottom: 16 },
  moduleScroll: { flex: 1 },
  moduleRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 14,
    borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10,
  },
  moduleIconBox: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  moduleBody: { flex: 1, gap: 6 },
  moduleTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  moduleTitle: { fontSize: 15, fontWeight: '700' },
  moduleTag: { borderWidth: 1, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  moduleTagText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
  moduleDesc: { fontSize: 13, lineHeight: 18 },

  privacyLine: { fontSize: 17, lineHeight: 26, textAlign: 'center', fontWeight: '500' },
  infoCard: {
    borderRadius: 14, borderWidth: 1, flexDirection: 'row', overflow: 'hidden', width: '100%',
  },
  infoBar: { width: 4 },
  infoCardContent: { flex: 1, padding: 14, gap: 6 },
  infoCardTitle: { fontSize: 14, fontWeight: '700' },
  infoCardBody: { fontSize: 13, lineHeight: 19 },

  footer: { paddingHorizontal: 24, paddingTop: 16, gap: 16, borderTopWidth: StyleSheet.hairlineWidth },
  dots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  dot: { height: 7, borderRadius: 4 },
  btn: { borderRadius: 16, paddingVertical: 18, alignItems: 'center' },
  btnText: { fontSize: 17, fontWeight: '800', letterSpacing: 0.3 },
});
