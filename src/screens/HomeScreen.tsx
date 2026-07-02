import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Animated, StatusBar, Dimensions, Image,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { IconSettings, IconModels } from '../components/Icons';
import {
  fetchAndCacheFixtures, findClosestMatch, isLive,
  fmtMatchTime, teamAbbr, isWorldCup, badgeUrl,
  type Fixture,
} from '../utils/fixtures';

// Team badge with graceful fallback to a colored abbreviation circle
function TeamBadge({ url, abbr, fallbackColor }: { url: string | null; abbr: string; fallbackColor: string }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      <View style={tbStyles.badgeWrap}>
        <Image
          source={{ uri: url }}
          style={tbStyles.badgeImg}
          resizeMode="contain"
          onError={() => setFailed(true)}
        />
      </View>
    );
  }
  return (
    <View style={[tbStyles.circle, { backgroundColor: fallbackColor }]}>
      <Text style={tbStyles.letter}>{abbr}</Text>
    </View>
  );
}
const tbStyles = StyleSheet.create({
  badgeWrap: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  badgeImg: { width: 30, height: 30 },
  circle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  letter: { fontSize: 11, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
});
import { llmManager } from '../utils/modelManager';
import { syncModelsFromDisk } from '../utils/storage';

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
  const [loadedModel, setLoadedModel] = useState<string | null>(null);
  const [hasAnyModel, setHasAnyModel] = useState<boolean | null>(null); // null = checking
  const [modelLoading, setModelLoading] = useState(false);
  const mountedRef = useRef(true);
  const lastFixtureFetchRef = useRef(0);
  const hasMatchRef = useRef(false);

  const c1 = useRef({ ty: new Animated.Value(28), op: new Animated.Value(0) }).current;
  const c2 = useRef({ ty: new Animated.Value(28), op: new Animated.Value(0) }).current;
  const c3 = useRef({ ty: new Animated.Value(28), op: new Animated.Value(0) }).current;

  // Refetch fixtures so the card never shows a stale match: a finished game
  // rotates to the next kick-off, live scores update, and a new day replaces
  // yesterday's fixtures entirely.
  const refreshFixtures = useCallback((force = false) => {
    const stale = Date.now() - lastFixtureFetchRef.current > 3 * 60_000;
    if (!force && !stale && hasMatchRef.current) return;
    lastFixtureFetchRef.current = Date.now();
    fetchAndCacheFixtures().then(({ fixtures, fromCache, online }) => {
      if (!mountedRef.current) return;
      const match = findClosestMatch(fixtures);
      hasMatchRef.current = !!match;
      setNextMatch(match);
      setMatchOnline(online);
      setMatchFromCache(fromCache);
    }).catch(() => {});
  }, []);

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

    refreshFixtures(true);
    // Home is the root screen and never unmounts — keep the match fresh
    // while the app sits open (live score ticks, finished games rotate out)
    const interval = setInterval(() => refreshFixtures(true), 5 * 60_000);

    return () => { mountedRef.current = false; clearInterval(interval); };
  }, [refreshFixtures]);

  // Refresh model status every time this screen is focused;
  // refetch fixtures when stale or missing (e.g. came back online)
  useFocusEffect(useCallback(() => {
    mountedRef.current = true;
    syncModelsFromDisk().then(models => {
      if (!mountedRef.current) return;
      setHasAnyModel(models.some(m => m.modelType === 'text'));
      setLoadedModel(llmManager.getLoadedModelId());
    }).catch(() => { setHasAnyModel(false); });
    refreshFixtures();
    return () => { mountedRef.current = false; };
  }, [refreshFixtures]));

  const accent = '#22c55e';

  const go = (tab: string, prefill?: string) =>
    navigation.navigate(tab, prefill ? { prefill } : undefined);

  const quickLoad = async () => {
    if (modelLoading) return;
    setModelLoading(true);
    try {
      const models = await syncModelsFromDisk();
      const text = models.find(m => m.modelType === 'text');
      if (!text) { navigation.navigate('Models'); return; }
      await llmManager.ensure(text, { ctx_size: 4096, device: 'auto', tools: true, projectionModelSrc: text.projectionModelSrc });
      setLoadedModel(llmManager.getLoadedModelId());
    } catch {}
    setModelLoading(false);
  };

  const quickStop = async () => {
    await llmManager.release();
    setLoadedModel(null);
  };

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
            <TouchableOpacity style={styles.iconChip} onPress={() => navigation.navigate('Models')} hitSlop={HIT}>
              <IconModels size={17} color="rgba(255,255,255,0.75)" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconChip} onPress={() => navigation.navigate('Settings')} hitSlop={HIT}>
              <IconSettings size={17} color="rgba(255,255,255,0.75)" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── MODEL STATUS STRIP ───────────────────────────────────── */}
        {hasAnyModel !== null && (
          <View style={[styles.modelStrip, { backgroundColor: theme.card }]}>
            {loadedModel ? (
              <>
                <View style={styles.modelStripLeft}>
                  <View style={[styles.modelStatusDot, { backgroundColor: accent }]} />
                  <Text style={[styles.modelStatusText, { color: accent }]}>AI Ready</Text>
                </View>
                <TouchableOpacity onPress={quickStop} style={[styles.modelStripBtn, { borderColor: '#ef444440' }]}>
                  <Text style={[styles.modelStripBtnText, { color: '#ef4444' }]}>Stop</Text>
                </TouchableOpacity>
              </>
            ) : hasAnyModel ? (
              <>
                <View style={styles.modelStripLeft}>
                  <View style={[styles.modelStatusDot, { backgroundColor: theme.border }]} />
                  <Text style={[styles.modelStatusText, { color: theme.textSecondary }]}>Model not loaded</Text>
                </View>
                <TouchableOpacity
                  onPress={quickLoad}
                  style={[styles.modelStripBtn, { borderColor: accent + '50', backgroundColor: accent + '12' }]}
                  disabled={modelLoading}
                >
                  <Text style={[styles.modelStripBtnText, { color: accent }]}>
                    {modelLoading ? 'Loading...' : 'Start'}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.modelStripLeft}>
                  <View style={[styles.modelStatusDot, { backgroundColor: '#f59e0b' }]} />
                  <Text style={[styles.modelStatusText, { color: '#f59e0b' }]}>No model downloaded</Text>
                </View>
                <TouchableOpacity
                  onPress={() => navigation.navigate('Models')}
                  style={[styles.modelStripBtn, { borderColor: '#f59e0b50', backgroundColor: '#f59e0b12' }]}
                >
                  <Text style={[styles.modelStripBtnText, { color: '#f59e0b' }]}>Get Model</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* ── AI COACH CARD ─────────────────────────────────────────── */}
        <Animated.View style={[styles.fullCardWrap, { opacity: c1.op, transform: [{ translateY: c1.ty }] }]}>
          <TouchableOpacity style={styles.coachCard} onPress={() => go('MatchAI')} activeOpacity={0.85}>
            {/* Pitch markings — decorative center circle + halfway line */}
            <View pointerEvents="none" style={styles.pitchCircleOuter} />
            <View pointerEvents="none" style={styles.pitchCircleInner} />
            <View pointerEvents="none" style={styles.pitchLine} />
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
                    <TeamBadge
                      url={badgeUrl(nextMatch.strHomeTeamBadge)}
                      abbr={teamAbbr(nextMatch.strHomeTeam)}
                      fallbackColor="#ef4444"
                    />
                    <Text style={styles.teamName} numberOfLines={1}>{nextMatch.strHomeTeam.split(' ')[0]}</Text>
                  </View>
                  <View style={styles.vsCol}>
                    {nextMatch.intHomeScore != null && nextMatch.intAwayScore != null ? (
                      <Text style={styles.scoreLabel}>
                        {nextMatch.intHomeScore}-{nextMatch.intAwayScore}
                      </Text>
                    ) : (
                      <>
                        <Text style={styles.vsLabel}>vs</Text>
                        {fmtMatchTime(nextMatch.strTime) ? (
                          <Text style={styles.matchTime}>{fmtMatchTime(nextMatch.strTime)}</Text>
                        ) : null}
                      </>
                    )}
                  </View>
                  <View style={styles.teamCol}>
                    <TeamBadge
                      url={badgeUrl(nextMatch.strAwayTeamBadge)}
                      abbr={teamAbbr(nextMatch.strAwayTeam)}
                      fallbackColor="#3b82f6"
                    />
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

        {/* ── QUICK ANALYSIS CHIPS ─────────────────────────────────── */}
        <Animated.View style={{ opacity: c3.op, transform: [{ translateY: c3.ty }] }}>
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
        </Animated.View>

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
  topActions: { flexDirection: 'row', gap: 10 },
  iconChip: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center', justifyContent: 'center',
  },

  // Chips
  chipsSection: { marginTop: 20, gap: 9 },
  chipsLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.6, paddingHorizontal: 20 },
  chipsRow: { paddingHorizontal: 16, gap: 8 },
  chip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontSize: 13, fontWeight: '700' },

  // Model status strip
  modelStrip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 14, marginTop: 4, marginBottom: 2,
    borderRadius: 14, paddingVertical: 11, paddingHorizontal: 15,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)',
  },
  modelStripLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modelStatusDot: { width: 7, height: 7, borderRadius: 4 },
  modelStatusText: { fontSize: 13, fontWeight: '600' },
  modelStripBtn: {
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  modelStripBtnText: { fontSize: 12, fontWeight: '700' },

  // Full-width card wrapper
  fullCardWrap: { paddingHorizontal: 14, marginTop: 12 },

  // AI Coach card
  coachCard: {
    backgroundColor: '#0c1f0c', borderRadius: 24, padding: 22, gap: 18, overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(34,197,94,0.22)',
  },
  pitchCircleOuter: {
    position: 'absolute', right: -70, bottom: -70, width: 200, height: 200,
    borderRadius: 100, borderWidth: 1.5, borderColor: 'rgba(34,197,94,0.10)',
  },
  pitchCircleInner: {
    position: 'absolute', right: -25, bottom: -25, width: 110, height: 110,
    borderRadius: 55, borderWidth: 1.5, borderColor: 'rgba(34,197,94,0.14)',
  },
  pitchLine: {
    position: 'absolute', right: 30, top: 0, bottom: 0, width: 1.5,
    backgroundColor: 'rgba(34,197,94,0.07)',
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
    flex: 1, backgroundColor: '#1a0d00', borderRadius: 24, padding: 18, gap: 10, overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(249,115,22,0.22)',
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
  teamName: { fontSize: 10, color: 'rgba(255,255,255,0.55)', fontWeight: '600', maxWidth: 60 },
  vsLabel: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.35)' },
  scoreLabel: { fontSize: 16, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  matchTime: { fontSize: 10, color: '#f97316', fontWeight: '700' },
  offlineHint: { fontSize: 9, color: 'rgba(255,255,255,0.25)', marginTop: -2 },

  predictCta: { fontSize: 13, fontWeight: '800', color: '#f97316', marginTop: 2 },

  // Scout Lens card
  lensCard: {
    flex: 1, backgroundColor: '#0a0e18', borderRadius: 24, padding: 18, gap: 8, overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(52,211,153,0.22)',
  },
  lensModLabel: { fontSize: 9, fontWeight: '800', color: '#34d399', letterSpacing: 1.6 },
  lensBracketWrap: { marginTop: 2, marginBottom: 2 },
  lensTitle: { fontSize: 15, fontWeight: '800', color: '#fff', lineHeight: 22, letterSpacing: -0.2 },
  lensCta: { fontSize: 13, fontWeight: '800', color: '#34d399', marginTop: 2 },

  // Footer
  footer: { alignItems: 'center', marginTop: 24 },
  footerText: { fontSize: 11 },
});
