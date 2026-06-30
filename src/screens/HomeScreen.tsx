import React, { useRef, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Animated, StatusBar, Dimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { IconSettings, IconModels } from '../components/Icons';
import {
  fetchAndCacheFixtures, findClosestMatch, isLive,
  fmtMatchTime, teamAbbr, isWorldCup,
  type Fixture,
} from '../utils/fixtures';

const { width: SW } = Dimensions.get('window');
const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

// ── Animated AI waveform ────────────────────────────────────────────────────

function Waveform({ color, count = 16 }: { color: string; count?: number }) {
  const anims = useRef(
    Array.from({ length: count }, () => new Animated.Value(0.2 + Math.random() * 0.7))
  ).current;

  useEffect(() => {
    const loops = anims.map((a, i) => {
      const dur = 320 + Math.random() * 480;
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(a, { toValue: 0.15 + Math.random() * 0.85, duration: dur, useNativeDriver: true }),
          Animated.timing(a, { toValue: 0.2 + Math.random() * 0.55, duration: dur * 0.85, useNativeDriver: true }),
        ])
      );
      setTimeout(() => loop.start(), i * 28);
      return loop;
    });
    return () => loops.forEach((l) => l.stop());
  }, []);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, height: 50 }}>
      {anims.map((a, i) => (
        <Animated.View
          key={i}
          style={{
            width: 3.5, height: 50, borderRadius: 3,
            backgroundColor: color,
            transform: [{ scaleY: a }],
          }}
        />
      ))}
    </View>
  );
}

// ── Scan brackets (Scout Lens card visual) ──────────────────────────────────

function ScanBrackets({ color }: { color: string }) {
  return (
    <View style={{ width: 52, height: 52 }}>
      {/* TL */}
      <View style={[sbStyles.corner, { top: 0, left: 0, borderTopWidth: 2.5, borderLeftWidth: 2.5, borderColor: color }]} />
      {/* TR */}
      <View style={[sbStyles.corner, { top: 0, right: 0, borderTopWidth: 2.5, borderRightWidth: 2.5, borderColor: color }]} />
      {/* BL */}
      <View style={[sbStyles.corner, { bottom: 0, left: 0, borderBottomWidth: 2.5, borderLeftWidth: 2.5, borderColor: color }]} />
      {/* BR */}
      <View style={[sbStyles.corner, { bottom: 0, right: 0, borderBottomWidth: 2.5, borderRightWidth: 2.5, borderColor: color }]} />
    </View>
  );
}
const sbStyles = StyleSheet.create({
  corner: { position: 'absolute', width: 15, height: 15 },
});

// ── Quick analysis chips ────────────────────────────────────────────────────

const CHIPS = [
  { label: 'High Press', q: 'Explain high press tactics — how does it work and which clubs master it?' },
  { label: 'Offside Rule', q: 'Explain the offside rule simply with a clear example.' },
  { label: 'Best Striker', q: 'Who is the greatest striker in Champions League history and why?' },
  { label: 'Formations', q: 'Compare the 4-3-3 and 4-2-3-1 formations — when is each most effective?' },
  { label: 'Pressing Stats', q: 'How do analysts measure pressing intensity and team press?' },
];

// ─────────────────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const insets = useSafeAreaInsets();

  const [nextMatch, setNextMatch] = useState<Fixture | null>(null);
  const [matchOnline, setMatchOnline] = useState(true);
  const [matchFromCache, setMatchFromCache] = useState(false);
  const mountedRef = useRef(true);

  const c1 = useRef({ ty: new Animated.Value(28), op: new Animated.Value(0) }).current;
  const c2 = useRef({ ty: new Animated.Value(28), op: new Animated.Value(0) }).current;
  const c3 = useRef({ ty: new Animated.Value(28), op: new Animated.Value(0) }).current;

  useEffect(() => {
    mountedRef.current = true;

    const animCard = (c: typeof c1, delay: number) => {
      setTimeout(() => {
        Animated.parallel([
          Animated.spring(c.ty, { toValue: 0, friction: 9, tension: 85, useNativeDriver: true }),
          Animated.timing(c.op, { toValue: 1, duration: 280, useNativeDriver: true }),
        ]).start();
      }, delay);
    };
    animCard(c1, 240);
    animCard(c2, 360);
    animCard(c3, 480);

    fetchAndCacheFixtures().then(({ fixtures, fromCache, online }) => {
      if (!mountedRef.current) return;
      setNextMatch(findClosestMatch(fixtures));
      setMatchOnline(online);
      setMatchFromCache(fromCache);
    });

    return () => { mountedRef.current = false; };
  }, []);

  const accent = '#22c55e';

  const go = (tab: string, prefill?: string) =>
    navigation.navigate(tab, prefill ? { prefill } : undefined);

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar barStyle="light-content" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 36 }}>

        {/* ── TOP BAR ──────────────────────────────────────────────── */}
        <View style={[styles.topBar, { paddingTop: insets.top + 14 }]}>
          <View style={styles.wordmarkRow}>
            <View style={[styles.wDot, { backgroundColor: accent }]} />
            <Text style={styles.wordmark}>SCOUT</Text>
          </View>
          <View style={styles.topActions}>
            <TouchableOpacity onPress={() => navigation.navigate('Models')} hitSlop={HIT}>
              <IconModels size={19} color="rgba(255,255,255,0.45)" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('Settings')} hitSlop={HIT}>
              <IconSettings size={19} color="rgba(255,255,255,0.45)" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── AI COACH CARD ─────────────────────────────────────────── */}
        <Animated.View style={[styles.fullCardWrap, { opacity: c1.op, transform: [{ translateY: c1.ty }] }]}>
          <TouchableOpacity style={styles.coachCard} onPress={() => go('MatchAI')} activeOpacity={0.85}>
            <View style={styles.coachTop}>
              <View style={styles.coachTopLeft}>
                <Text style={styles.coachModLabel}>AI COACH</Text>
                <Text style={styles.coachTitle}>World-class{'\n'}football analysis</Text>
              </View>
              <Waveform color="#22c55e" count={10} />
            </View>
            <View style={styles.coachPills}>
              {['High press tactics?', 'Best striker ever?', 'Explain offside'].map((s) => (
                <View key={s} style={styles.coachPill}>
                  <Text style={styles.coachPillText}>{s}</Text>
                </View>
              ))}
            </View>
            <View style={styles.coachFooter}>
              <Text style={styles.coachCta}>Ask the Coach</Text>
              <View style={styles.coachArrow}><Text style={styles.coachArrowText}>→</Text></View>
            </View>
          </TouchableOpacity>
        </Animated.View>

        {/* ── PREDICTOR + LENS ROW ─────────────────────────────────── */}
        <Animated.View style={[styles.twoColRow, { opacity: c2.op, transform: [{ translateY: c2.ty }] }]}>

          {/* Predictor */}
          <TouchableOpacity style={styles.predictCard} onPress={() => go('Predictor')} activeOpacity={0.85}>
            <Text style={styles.predictModLabel}>PREDICTOR</Text>

            {nextMatch ? (
              <>
                {/* League / live badge */}
                <View style={styles.matchBadgeRow}>
                  {isLive(nextMatch) ? (
                    <View style={styles.liveBadge}>
                      <View style={styles.liveDot} />
                      <Text style={styles.liveBadgeText}>LIVE</Text>
                    </View>
                  ) : isWorldCup(nextMatch) ? (
                    <Text style={styles.wcLabel}>WC 2026</Text>
                  ) : (
                    <Text style={styles.wcLabel} numberOfLines={1}>{nextMatch.strLeague.slice(0, 14)}</Text>
                  )}
                  {matchFromCache && !matchOnline && (
                    <Text style={styles.cachedLabel}>cached</Text>
                  )}
                </View>

                {/* Teams */}
                <View style={styles.fixtureVis}>
                  <View style={styles.teamCol}>
                    <View style={[styles.teamCircle, { backgroundColor: '#ef4444' }]}>
                      <Text style={styles.teamLetter}>{teamAbbr(nextMatch.strHomeTeam)}</Text>
                    </View>
                    <Text style={styles.teamName} numberOfLines={1}>{nextMatch.strHomeTeam.split(' ')[0]}</Text>
                  </View>
                  <View style={styles.vsCol}>
                    <Text style={styles.vsLabel}>vs</Text>
                    {fmtMatchTime(nextMatch.strTime) ? (
                      <Text style={styles.matchTime}>{fmtMatchTime(nextMatch.strTime)}</Text>
                    ) : null}
                  </View>
                  <View style={styles.teamCol}>
                    <View style={[styles.teamCircle, { backgroundColor: '#3b82f6' }]}>
                      <Text style={styles.teamLetter}>{teamAbbr(nextMatch.strAwayTeam)}</Text>
                    </View>
                    <Text style={styles.teamName} numberOfLines={1}>{nextMatch.strAwayTeam.split(' ')[0]}</Text>
                  </View>
                </View>
              </>
            ) : (
              <>
                {/* Offline / no data fallback */}
                <View style={styles.offlineBadgeRow}>
                  {!matchOnline && (
                    <Text style={styles.offlineLabel}>offline</Text>
                  )}
                </View>
                <View style={styles.fixtureVis}>
                  <View style={styles.teamCol}>
                    <View style={[styles.teamCircle, { backgroundColor: '#374151' }]}>
                      <Text style={styles.teamLetter}>---</Text>
                    </View>
                    <Text style={styles.teamName}>Home</Text>
                  </View>
                  <View style={styles.vsCol}>
                    <Text style={styles.vsLabel}>vs</Text>
                  </View>
                  <View style={styles.teamCol}>
                    <View style={[styles.teamCircle, { backgroundColor: '#374151' }]}>
                      <Text style={styles.teamLetter}>---</Text>
                    </View>
                    <Text style={styles.teamName}>Away</Text>
                  </View>
                </View>
                {!matchOnline && (
                  <Text style={styles.offlineHint}>Go online for live fixtures</Text>
                )}
              </>
            )}

            <Text style={styles.predictCta}>Predict →</Text>
          </TouchableOpacity>

          {/* Scout Lens */}
          <TouchableOpacity style={styles.lensCard} onPress={() => go('ScoutLens')} activeOpacity={0.85}>
            <Text style={styles.lensModLabel}>SCOUT LENS</Text>
            <View style={styles.lensBracketWrap}>
              <ScanBrackets color="#34d399" />
            </View>
            <Text style={styles.lensTitle}>Jerseys,{'\n'}badges &{'\n'}scoreboards</Text>
            <Text style={styles.lensCta}>Scan →</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* ── FAN ROOM CARD ─────────────────────────────────────────── */}
        <Animated.View style={[styles.fullCardWrap, { opacity: c3.op, transform: [{ translateY: c3.ty }] }]}>
          <TouchableOpacity style={styles.fanCard} onPress={() => go('FanRoom')} activeOpacity={0.85}>
            <View style={styles.fanLeft}>
              <Text style={styles.fanModLabel}>FAN ROOM</Text>
              <Text style={styles.fanTitle}>Live fan{'\n'}chat</Text>
              <Text style={styles.fanDesc}>Device-to-device via Pears.{'\n'}No internet needed in the stadium.</Text>
              <View style={[styles.pearsBadge, { backgroundColor: '#3b82f618', borderColor: '#3b82f635' }]}>
                <View style={[styles.pearsDot, { backgroundColor: '#3b82f6' }]} />
                <Text style={[styles.pearsLabel, { color: '#3b82f6' }]}>PEARS P2P</Text>
              </View>
            </View>
            <View style={styles.fanRight}>
              {(['F', 'A', 'N'] as const).map((l, i) => (
                <View
                  key={l}
                  style={[
                    styles.fanAvatar,
                    { marginTop: i > 0 ? -10 : 0 },
                    { backgroundColor: i === 0 ? '#60a5fa' : i === 1 ? '#60a5facc' : '#60a5fa80' },
                  ]}
                >
                  <Text style={styles.fanAvatarText}>{l}</Text>
                </View>
              ))}
              <Text style={styles.fanJoin}>Join →</Text>
            </View>
          </TouchableOpacity>
        </Animated.View>

        {/* ── QUICK ANALYSIS CHIPS ─────────────────────────────────── */}
        <View style={styles.chipsSection}>
          <Text style={[styles.chipsLabel, { color: theme.textSecondary }]}>QUICK ANALYSIS</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            {CHIPS.map((chip) => (
              <TouchableOpacity
                key={chip.label}
                style={[styles.chip, { backgroundColor: accent + '16', borderColor: accent + '32' }]}
                onPress={() => go('MatchAI', chip.q)}
                activeOpacity={0.72}
              >
                <Text style={[styles.chipText, { color: accent }]}>{chip.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <TouchableOpacity onPress={() => navigation.navigate('About')} style={styles.footer}>
          <Text style={[styles.footerText, { color: theme.textSecondary }]}>
            Scout · Tether Developers Cup 2026
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Top bar
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingBottom: 10,
  },
  wordmarkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wDot: { width: 7, height: 7, borderRadius: 3.5 },
  wordmark: { fontSize: 20, fontWeight: '900', color: '#fff', letterSpacing: 4 },
  topActions: { flexDirection: 'row', gap: 20 },

  // Hero banner
  heroBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#0d1f0d', marginHorizontal: 14, marginTop: 6,
    borderRadius: 22, paddingHorizontal: 24, paddingVertical: 22, overflow: 'hidden',
  },
  heroLeft: { gap: 4 },
  heroNum: { fontSize: 78, fontWeight: '900', color: '#fff', lineHeight: 78, letterSpacing: -4 },
  heroNumLabel: { fontSize: 13, fontWeight: '800', letterSpacing: 1.2 },
  heroDesc: { fontSize: 11.5, color: 'rgba(255,255,255,0.38)', marginTop: 8, lineHeight: 18 },
  heroRight: { alignItems: 'center', gap: 14 },
  aiReadyBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1,
  },
  aiDot: { width: 5, height: 5, borderRadius: 2.5 },
  aiText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },

  // Chips
  chipsSection: { marginTop: 20, gap: 9 },
  chipsLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.6, paddingHorizontal: 20 },
  chipsRow: { paddingHorizontal: 16, gap: 8 },
  chip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontSize: 13, fontWeight: '700' },

  // Full-width card wrapper
  fullCardWrap: { paddingHorizontal: 14, marginTop: 12 },

  // AI Coach card
  coachCard: {
    backgroundColor: '#0c1f0c', borderRadius: 22, padding: 22, gap: 18, overflow: 'hidden',
  },
  coachTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  coachTopLeft: { gap: 6, flex: 1 },
  coachModLabel: { fontSize: 10, fontWeight: '800', color: '#22c55e', letterSpacing: 1.5 },
  coachTitle: { fontSize: 28, fontWeight: '900', color: '#fff', lineHeight: 34, letterSpacing: -0.6 },
  coachPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  coachPill: {
    backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  coachPillText: { fontSize: 12, color: 'rgba(255,255,255,0.65)' },
  coachFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  coachCta: { fontSize: 15, fontWeight: '800', color: '#22c55e' },
  coachArrow: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#22c55e', alignItems: 'center', justifyContent: 'center',
  },
  coachArrowText: { fontSize: 18, color: '#fff', fontWeight: '700' },

  // Two-column row
  twoColRow: {
    flexDirection: 'row', paddingHorizontal: 14, marginTop: 10, gap: 10,
  },

  // Predictor card
  predictCard: {
    flex: 1, backgroundColor: '#1a0d00', borderRadius: 22, padding: 18, gap: 10, overflow: 'hidden',
  },
  predictModLabel: { fontSize: 9, fontWeight: '800', color: '#f97316', letterSpacing: 1.6 },
  predictTitle: { fontSize: 21, fontWeight: '900', color: '#fff', lineHeight: 27, letterSpacing: -0.3 },

  // Match badge row (WC / LIVE / cached)
  matchBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  offlineBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 16 },
  wcLabel: { fontSize: 9, fontWeight: '800', color: '#f97316', letterSpacing: 1 },
  cachedLabel: { fontSize: 9, color: 'rgba(255,255,255,0.28)', fontStyle: 'italic' },
  offlineLabel: {
    fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.28)',
    letterSpacing: 0.8,
  },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#ef4444' },
  liveBadgeText: { fontSize: 9, fontWeight: '800', color: '#ef4444', letterSpacing: 1 },

  // Fixture vis
  fixtureVis: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  teamCol: { alignItems: 'center', gap: 3, flex: 1 },
  vsCol: { alignItems: 'center', gap: 2 },
  teamCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  teamLetter: { fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
  teamName: { fontSize: 9, color: 'rgba(255,255,255,0.45)', fontWeight: '600', maxWidth: 52 },
  vsLabel: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.35)' },
  matchTime: { fontSize: 9, color: '#f97316', fontWeight: '700' },
  offlineHint: { fontSize: 9, color: 'rgba(255,255,255,0.25)', marginTop: -2 },

  predictCta: { fontSize: 13, fontWeight: '800', color: '#f97316', marginTop: 2 },

  // Scout Lens card
  lensCard: {
    flex: 1, backgroundColor: '#0a0e18', borderRadius: 22, padding: 18, gap: 8, overflow: 'hidden',
  },
  lensModLabel: { fontSize: 9, fontWeight: '800', color: '#34d399', letterSpacing: 1.6 },
  lensBracketWrap: { marginTop: 2, marginBottom: 2 },
  lensTitle: { fontSize: 15, fontWeight: '800', color: '#fff', lineHeight: 22, letterSpacing: -0.2 },
  lensCta: { fontSize: 13, fontWeight: '800', color: '#34d399', marginTop: 2 },

  // Fan Room card
  fanCard: {
    backgroundColor: '#080c18', borderRadius: 22, padding: 22,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    overflow: 'hidden',
  },
  fanLeft: { flex: 1, gap: 8 },
  fanModLabel: { fontSize: 9, fontWeight: '800', color: '#60a5fa', letterSpacing: 1.6 },
  fanTitle: { fontSize: 26, fontWeight: '900', color: '#fff', lineHeight: 32, letterSpacing: -0.5 },
  fanDesc: { fontSize: 11, color: 'rgba(255,255,255,0.38)', lineHeight: 17 },
  pearsBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, marginTop: 2,
  },
  pearsDot: { width: 5, height: 5, borderRadius: 2.5 },
  pearsLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  fanRight: { alignItems: 'center', paddingLeft: 16, paddingTop: 4 },
  fanAvatar: {
    width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
  },
  fanAvatarText: { fontSize: 16, fontWeight: '800', color: '#fff' },
  fanJoin: { fontSize: 13, fontWeight: '800', color: '#60a5fa', marginTop: 14 },

  // Footer
  footer: { alignItems: 'center', marginTop: 24 },
  footerText: { fontSize: 11 },
});
