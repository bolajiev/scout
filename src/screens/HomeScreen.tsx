import React, { useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, StatusBar,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import {
  IconBall, IconTarget, IconCamera, IconFanRoom,
  IconSettings, IconModels,
} from '../components/Icons';

const MODULES = [
  {
    id: 'MatchAI',
    screen: 'MatchAI',
    title: 'AI Coach',
    desc: 'Ask anything about football — tactics, players, teams. On-device. No internet needed.',
    track: 'QVAC',
    trackColor: '#22c55e',
    icon: (c: string) => <IconBall size={32} color={c} />,
  },
  {
    id: 'Predictor',
    screen: 'Predictor',
    title: 'Predictor',
    desc: 'Pick two teams. Get an on-device AI match prediction with reasoning.',
    track: 'QVAC + RAG',
    trackColor: '#22c55e',
    icon: (c: string) => <IconTarget size={32} color={c} />,
  },
  {
    id: 'ScoutLens',
    screen: 'ScoutLens',
    title: 'Scout Lens',
    desc: 'Point your camera at a jersey, player card, or match screen. AI tells you who it is.',
    track: 'QVAC Vision',
    trackColor: '#22c55e',
    icon: (c: string) => <IconCamera size={32} color={c} />,
  },
  {
    id: 'FanRoom',
    screen: 'FanRoom',
    title: 'Fan Room',
    desc: 'Device-to-device fan chat. No server, no account. Works offline in the stadium.',
    track: 'Pears P2P',
    trackColor: '#60a5fa',
    icon: (c: string) => <IconFanRoom size={32} color={c} />,
  },
];

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const insets = useSafeAreaInsets();

  // Hero entrance
  const heroOpacity = useRef(new Animated.Value(0)).current;
  const heroY = useRef(new Animated.Value(12)).current;

  // Per-card animated values — translateY + opacity
  const cardAnims = useRef(
    MODULES.map(() => ({
      ty: new Animated.Value(44),
      op: new Animated.Value(0),
    }))
  ).current;

  useEffect(() => {
    // Hero fades in first
    Animated.parallel([
      Animated.timing(heroOpacity, { toValue: 1, duration: 380, useNativeDriver: true }),
      Animated.spring(heroY, { toValue: 0, friction: 10, tension: 100, useNativeDriver: true }),
    ]).start();

    // Cards stagger in after a 160ms head-start
    const cardAnimations = cardAnims.map(anim =>
      Animated.parallel([
        Animated.spring(anim.ty, { toValue: 0, friction: 9, tension: 90, useNativeDriver: true }),
        Animated.timing(anim.op, { toValue: 1, duration: 300, useNativeDriver: true }),
      ])
    );
    setTimeout(() => {
      Animated.stagger(70, cardAnimations).start();
    }, 160);
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: theme.border }]}>
        <View style={styles.brand}>
          <View style={[styles.brandDot, { backgroundColor: theme.accent }]} />
          <Text style={[styles.brandName, { color: theme.text }]}>Scout</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => navigation.navigate('Models')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <IconModels size={20} color={theme.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => navigation.navigate('Settings')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <IconSettings size={20} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero — slides in */}
        <Animated.View style={[styles.hero, { opacity: heroOpacity, transform: [{ translateY: heroY }] }]}>
          <Text style={[styles.heroTitle, { color: theme.text }]}>Your on-device{'\n'}football AI.</Text>
          <Text style={[styles.heroSub, { color: theme.textSecondary }]}>
            AI runs on your phone. No cloud. No API key. Works in the stadium.
          </Text>
          <View style={[styles.heroBadge, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
            <View style={[styles.heroBadgeDot, { backgroundColor: theme.accent }]} />
            <Text style={[styles.heroBadgeText, { color: theme.textSecondary }]}>
              Tether Developers Cup 2026
            </Text>
          </View>
        </Animated.View>

        {/* Stats strip */}
        <View style={[styles.statsStrip, { backgroundColor: theme.card, borderColor: theme.border }]}>
          {[
            { value: '4', label: 'Modules' },
            { value: 'QVAC', label: 'SDK' },
            { value: 'P2P', label: 'Pears' },
            { value: '100%', label: 'On-Device' },
          ].map((s, i) => (
            <React.Fragment key={s.label}>
              {i > 0 && <View style={[styles.statsDivider, { backgroundColor: theme.border }]} />}
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: theme.accent }]}>{s.value}</Text>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>{s.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>

        {/* Module cards — stagger in */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Modules</Text>
        {MODULES.map((mod, i) => (
          <Animated.View
            key={mod.id}
            style={{ opacity: cardAnims[i].op, transform: [{ translateY: cardAnims[i].ty }] }}
          >
            <TouchableOpacity
              activeOpacity={0.72}
              onPress={() => navigation.navigate(mod.screen)}
            >
              <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <View style={[styles.accentBar, { backgroundColor: mod.trackColor }]} />
                <View style={styles.cardInner}>
                  <View style={styles.cardLeft}>
                    <Text style={[styles.cardTitle, { color: theme.text }]}>{mod.title}</Text>
                    <Text style={[styles.cardDesc, { color: theme.textSecondary }]}>{mod.desc}</Text>
                    <View style={[styles.trackBadge, { backgroundColor: mod.trackColor + '18', borderColor: mod.trackColor + '44' }]}>
                      <Text style={[styles.trackText, { color: mod.trackColor }]}>{mod.track}</Text>
                    </View>
                  </View>
                  <View style={[styles.iconBox, { backgroundColor: mod.trackColor + '14' }]}>
                    {mod.icon(mod.trackColor)}
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          </Animated.View>
        ))}

        {/* Footer */}
        <TouchableOpacity onPress={() => navigation.navigate('About')} style={styles.footer}>
          <Text style={[styles.footerText, { color: theme.textSecondary }]}>
            Scout v1.0 · QVAC SDK · Pears · On-Device AI
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandDot: { width: 8, height: 8, borderRadius: 4 },
  brandName: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5 },
  headerActions: { flexDirection: 'row', gap: 16 },
  headerBtn: { padding: 4 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 24 },
  hero: { marginBottom: 32, gap: 10 },
  heroTitle: { fontSize: 32, fontWeight: '800', letterSpacing: -1, lineHeight: 38 },
  heroSub: { fontSize: 14, lineHeight: 20 },
  heroBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, marginTop: 4,
  },
  heroBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  heroBadgeText: { fontSize: 11, fontWeight: '600' },
  sectionLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1.4,
    textTransform: 'uppercase', marginBottom: 12,
  },
  card: {
    borderRadius: 14, borderWidth: 1, marginBottom: 12,
    flexDirection: 'row', overflow: 'hidden',
  },
  accentBar: { width: 4 },
  cardInner: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', padding: 18, gap: 16,
  },
  cardLeft: { flex: 1, gap: 6 },
  cardTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
  cardDesc: { fontSize: 13, lineHeight: 19 },
  trackBadge: {
    alignSelf: 'flex-start', borderWidth: 1, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3, marginTop: 2,
  },
  trackText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  iconBox: {
    width: 60, height: 60, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  statsStrip: {
    flexDirection: 'row', borderRadius: 14, borderWidth: 1,
    marginBottom: 28, overflow: 'hidden',
  },
  statItem: { flex: 1, alignItems: 'center', paddingVertical: 14, gap: 3 },
  statValue: { fontSize: 15, fontWeight: '800', letterSpacing: -0.3 },
  statLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },
  statsDivider: { width: 1 },
  footer: { alignItems: 'center', marginTop: 16 },
  footerText: { fontSize: 11 },
});
