import React, { useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Animated, StatusBar, Dimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import {
  IconBall, IconTarget, IconCamera, IconFanRoom,
  IconSettings, IconModels,
} from '../components/Icons';

const { width: SW } = Dimensions.get('window');

const MODULES = [
  {
    id: 'MatchAI',
    tab: 'MatchAI',
    title: 'AI Coach',
    desc: 'Tactics, players, clubs — on-device.',
    track: 'QVAC',
    trackColor: '#22c55e',
    Icon: IconBall,
  },
  {
    id: 'Predictor',
    tab: 'Predictor',
    title: 'Predictor',
    desc: 'Match prediction with score + reasoning.',
    track: 'QVAC',
    trackColor: '#22c55e',
    Icon: IconTarget,
  },
  {
    id: 'ScoutLens',
    tab: 'ScoutLens',
    title: 'Scout Lens',
    desc: 'Identify jerseys, badges, scoreboards.',
    track: 'QVAC Vision',
    trackColor: '#22c55e',
    Icon: IconCamera,
  },
  {
    id: 'FanRoom',
    tab: 'FanRoom',
    title: 'Fan Room',
    desc: 'P2P fan chat. No internet needed.',
    track: 'Pears P2P',
    trackColor: '#60a5fa',
    Icon: IconFanRoom,
  },
];

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const insets = useSafeAreaInsets();

  const heroOpacity = useRef(new Animated.Value(0)).current;
  const heroScale = useRef(new Animated.Value(0.96)).current;
  const cardAnims = useRef(MODULES.map(() => ({
    ty: new Animated.Value(40),
    op: new Animated.Value(0),
  }))).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(heroOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(heroScale, { toValue: 1, friction: 10, tension: 80, useNativeDriver: true }),
    ]).start();

    setTimeout(() => {
      Animated.stagger(65, cardAnims.map(a =>
        Animated.parallel([
          Animated.spring(a.ty, { toValue: 0, friction: 9, tension: 90, useNativeDriver: true }),
          Animated.timing(a.op, { toValue: 1, duration: 280, useNativeDriver: true }),
        ])
      )).start();
    }, 180);
  }, []);

  const accent = theme.accent;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        {/* ── PITCH HERO ─────────────────────────────────────────── */}
        <Animated.View style={[
          styles.hero,
          { paddingTop: insets.top + 16, opacity: heroOpacity, transform: [{ scale: heroScale }] },
        ]}>
          {/* Decorative pitch elements */}
          <View style={[styles.pitchCircleOuter, { borderColor: accent + '18' }]} />
          <View style={[styles.pitchCircleInner, { borderColor: accent + '12' }]} />
          <View style={[styles.pitchMidLine, { backgroundColor: accent + '10' }]} />

          {/* Header row */}
          <View style={[styles.heroHeader, { paddingHorizontal: 20 }]}>
            <View style={styles.wordmarkRow}>
              <View style={[styles.wordmarkDot, { backgroundColor: accent }]} />
              <Text style={styles.wordmark}>SCOUT</Text>
            </View>
            <View style={styles.heroActions}>
              <TouchableOpacity onPress={() => navigation.navigate('Models')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <IconModels size={19} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.navigate('Settings')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <IconSettings size={19} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Hero body */}
          <View style={styles.heroBody}>
            <Text style={styles.heroTagline}>On-Device Football AI</Text>
            <View style={[styles.aiReadyBadge, { backgroundColor: accent + '28', borderColor: accent + '50' }]}>
              <View style={[styles.aiReadyDot, { backgroundColor: accent }]} />
              <Text style={[styles.aiReadyText, { color: accent }]}>AI READY · NO CLOUD</Text>
            </View>
            <View style={styles.heroStats}>
              {[
                { v: '4', l: 'Modules' },
                { v: 'QVAC', l: 'SDK' },
                { v: 'P2P', l: 'Pears' },
              ].map((s, i) => (
                <React.Fragment key={s.l}>
                  {i > 0 && <View style={styles.heroStatDiv} />}
                  <View style={styles.heroStat}>
                    <Text style={[styles.heroStatVal, { color: '#fff' }]}>{s.v}</Text>
                    <Text style={[styles.heroStatLabel, { color: 'rgba(255,255,255,0.5)' }]}>{s.l}</Text>
                  </View>
                </React.Fragment>
              ))}
            </View>
          </View>
        </Animated.View>

        {/* ── MODULE GRID ────────────────────────────────────────── */}
        <View style={styles.gridWrap}>
          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>MODULES</Text>
          <View style={styles.grid}>
            {MODULES.map((mod, i) => (
              <Animated.View
                key={mod.id}
                style={[
                  styles.gridCell,
                  { opacity: cardAnims[i].op, transform: [{ translateY: cardAnims[i].ty }] },
                ]}
              >
                <TouchableOpacity
                  style={[styles.tile, { backgroundColor: theme.card, borderColor: theme.border }]}
                  activeOpacity={0.72}
                  onPress={() => navigation.navigate(mod.tab)}
                >
                  {/* Top accent stripe */}
                  <View style={[styles.tileStripe, { backgroundColor: mod.trackColor }]} />

                  <View style={styles.tileBody}>
                    <View style={[styles.tileIconBox, { backgroundColor: mod.trackColor + '18' }]}>
                      <mod.Icon size={26} color={mod.trackColor} />
                    </View>
                    <Text style={[styles.tileTitle, { color: theme.text }]}>{mod.title}</Text>
                    <Text style={[styles.tileDesc, { color: theme.textSecondary }]} numberOfLines={2}>
                      {mod.desc}
                    </Text>
                    <View style={[styles.tileBadge, { backgroundColor: mod.trackColor + '18', borderColor: mod.trackColor + '44' }]}>
                      <Text style={[styles.tileBadgeText, { color: mod.trackColor }]}>{mod.track}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              </Animated.View>
            ))}
          </View>
        </View>

        {/* ── FOOTER ─────────────────────────────────────────────── */}
        <TouchableOpacity onPress={() => navigation.navigate('About')} style={styles.footer}>
          <Text style={[styles.footerText, { color: theme.textSecondary }]}>
            Scout v1.0 · Tether Developers Cup 2026
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const HERO_H = 260;

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Hero
  hero: {
    height: HERO_H,
    backgroundColor: '#0d1a0d',
    overflow: 'hidden',
    marginBottom: 4,
  },
  pitchCircleOuter: {
    position: 'absolute',
    width: SW * 0.95,
    height: SW * 0.95,
    borderRadius: SW * 0.475,
    borderWidth: 1,
    top: HERO_H / 2 - SW * 0.475,
    left: SW * 0.025,
  },
  pitchCircleInner: {
    position: 'absolute',
    width: SW * 0.5,
    height: SW * 0.5,
    borderRadius: SW * 0.25,
    borderWidth: 1,
    top: HERO_H / 2 - SW * 0.25,
    left: SW * 0.25,
  },
  pitchMidLine: {
    position: 'absolute',
    height: 1,
    left: 0,
    right: 0,
    top: HERO_H / 2,
  },
  heroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  wordmarkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wordmarkDot: { width: 7, height: 7, borderRadius: 3.5 },
  wordmark: { fontSize: 22, fontWeight: '900', color: '#fff', letterSpacing: 4 },
  heroActions: { flexDirection: 'row', gap: 20 },
  heroBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingBottom: 8,
  },
  heroTagline: { fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.7)', letterSpacing: 0.5 },
  aiReadyBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1,
  },
  aiReadyDot: { width: 6, height: 6, borderRadius: 3 },
  aiReadyText: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  heroStats: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  heroStat: { alignItems: 'center', gap: 2 },
  heroStatVal: { fontSize: 16, fontWeight: '800' },
  heroStatLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },
  heroStatDiv: { width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.15)' },

  // Grid
  gridWrap: { paddingHorizontal: 14, paddingTop: 20 },
  sectionLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1.6,
    marginBottom: 14, paddingLeft: 2,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gridCell: { width: (SW - 38) / 2 },
  tile: {
    borderRadius: 16, borderWidth: 1,
    overflow: 'hidden',
  },
  tileStripe: { height: 3 },
  tileBody: { padding: 16, gap: 8 },
  tileIconBox: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tileTitle: { fontSize: 15, fontWeight: '800', letterSpacing: -0.3, marginTop: 2 },
  tileDesc: { fontSize: 12, lineHeight: 17 },
  tileBadge: {
    alignSelf: 'flex-start', borderWidth: 1, borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 3, marginTop: 2,
  },
  tileBadgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.4 },

  // Footer
  footer: { alignItems: 'center', marginTop: 20 },
  footerText: { fontSize: 11 },
});
