import React, { useEffect, useRef } from 'react';
import { View, Text, Image, StyleSheet, ScrollView, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import { getTheme } from '../theme';
import { fonts } from '../theme/fonts';
import { useTheme } from '../navigation/AppNavigator';
import ScreenHeader from '../components/ScreenHeader';
import Glow from '../components/Glow';
import TeamBadge from '../components/TeamBadge';
import { teamAbbr } from '../utils/fixtures';
import type { BzPrediction } from '../utils/bzzoiro';

// Same ball asset used behind the Matches hero — one consistent football
// motif across the app rather than a second, differently-styled decoration.
const BALL = require('../../assets/ball.png');

// The prediction result on its own page — pushed over the tabs when a
// prediction completes, back button returns to the Predictor setup.
// Verdict + analysis only; no action buttons by design.

// Real probabilities from Bzzoiro's ML model, when the match resolved to a
// known event — converts 0-1 probs to a 100-summing 3-way split. Falls back
// to the LLM-confidence-derived split (below) when no match was found.
function bzSplit(p: BzPrediction): { home: number; draw: number; away: number } | null {
  if (p.probHome == null || p.probDraw == null || p.probAway == null) return null;
  const total = p.probHome + p.probDraw + p.probAway;
  if (total <= 0) return null;
  const home = Math.round((p.probHome / total) * 100);
  const draw = Math.round((p.probDraw / total) * 100);
  return { home, draw, away: 100 - home - draw };
}

function confidenceParts(raw: string): { pct: number | null } {
  const m = (raw ?? '').match(/(\d{1,3})/);
  let pct = m ? Math.min(95, Math.max(5, parseInt(m[1], 10))) : null;
  if (pct == null) {
    const w = (raw ?? '').toLowerCase();
    pct = w.includes('high') ? 80 : w.includes('med') ? 62 : w.includes('low') ? 45 : null;
  }
  return { pct };
}

function outcomeSplit(confRaw: string, winnerIsDraw: boolean): { home: number; draw: number; away: number } {
  const pct = confidenceParts(confRaw).pct ?? 55;
  const rem = 100 - pct;
  if (winnerIsDraw) {
    const side = Math.round(rem / 2);
    return { home: side, draw: pct, away: rem - side };
  }
  const draw = Math.round(rem * 0.45);
  return { home: pct, draw, away: rem - draw };
}

const playerName = (s: string) => (s ?? '').split(/\s[—–-]\s|,\s|\s\(/)[0].trim();

export default function PredictionResultScreen() {
  const route = useRoute<any>();
  const theme = getTheme(useTheme());
  const insets = useSafeAreaInsets();
  const accent = theme.accent;

  const {
    teamA = '', teamB = '', winner = '', score = '', confidence = '',
    keyHome = '', keyAway = '', analysis = '', elapsed,
    bzPrediction = null as BzPrediction | null,
  } = route.params ?? {};

  const winnerIsDraw = /draw/i.test(winner);
  const winnerIsA = !winnerIsDraw && winner === teamA;
  const realSplit = bzPrediction ? bzSplit(bzPrediction) : null;
  const split = realSplit ?? outcomeSplit(confidence, winnerIsDraw);
  const displayScore = score || bzPrediction?.mostLikelyScore || '';

  // The page itself now slides up as a deliberate reveal (see AppNavigator's
  // slide_from_bottom), but the verdict was still appearing instantly and
  // fully-formed the moment the page landed — a staggered fade+rise on the
  // two cards gives the result a beat to "arrive" instead of just popping in.
  const verdictAnim = useRef(new Animated.Value(0)).current;
  const analysisAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.stagger(120, [
      Animated.timing(verdictAnim, { toValue: 1, duration: 380, useNativeDriver: true }),
      Animated.timing(analysisAnim, { toValue: 1, duration: 380, useNativeDriver: true }),
    ]).start();
  }, []);
  const cardStyle = (v: Animated.Value) => ({
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
  });

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ScreenHeader title={`${teamA} vs ${teamB}`} subtitle="Scout's call · on-device" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>

        {/* Verdict */}
        <Animated.View style={[styles.verdict, { backgroundColor: '#0f0f0f', borderColor: theme.border }, cardStyle(verdictAnim)]}>
          <Glow color={accent} opacity={0.14} anchor="tl" />
          <View style={styles.verdictTop}>
            <View style={styles.verdictSide}>
              <TeamBadge name={teamA} abbr={teamAbbr(teamA)} size={32} />
              <Text style={[styles.verdictName, { color: theme.textSecondary }]} numberOfLines={1}>{teamA}</Text>
            </View>
            <Text style={[styles.verdictVs, { color: theme.textTertiary }]}>VS</Text>
            <View style={styles.verdictSide}>
              <TeamBadge name={teamB} abbr={teamAbbr(teamB)} size={32} />
              <Text style={[styles.verdictName, { color: theme.textSecondary }]} numberOfLines={1}>{teamB}</Text>
            </View>
          </View>

          <Text style={[styles.verdictEyebrow, { color: theme.textSecondary }]}>THE CALL</Text>
          <Text style={[styles.verdictHeadline, { color: theme.text }]}>
            {winnerIsDraw
              ? <>ENDS <Text style={{ color: accent }}>LEVEL</Text></>
              : <>{winner.toUpperCase()} <Text style={{ color: accent }}>TO WIN</Text></>}
          </Text>
          {displayScore ? (
            <Text style={[styles.mlsLine, { color: theme.textSecondary }]}>
              Most likely score <Text style={[styles.mlsScore, { color: theme.text }]}>{displayScore}</Text>
            </Text>
          ) : null}

          <View style={styles.outcomeRow}>
            {[
              { label: teamAbbr(teamA), pct: split.home, pick: winnerIsA },
              { label: 'DRAW', pct: split.draw, pick: winnerIsDraw },
              { label: teamAbbr(teamB), pct: split.away, pick: !winnerIsDraw && !winnerIsA },
            ].map(c => (
              <View key={c.label} style={[styles.outcomeChip, c.pick
                ? { backgroundColor: accent }
                : { backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: theme.border },
              ]}>
                <Text style={[styles.ocPct, { color: c.pick ? theme.accentFg : theme.text }]}>{c.pct}%</Text>
                <Text style={[styles.ocLabel, { color: c.pick ? theme.accentFg : theme.textSecondary }]}>{c.label}</Text>
              </View>
            ))}
          </View>
          <Text style={[styles.oddsSource, { color: theme.textTertiary }]}>
            {realSplit ? 'Real win probabilities · Bzzoiro ML model' : "Scout's own estimate from its confidence call"}
          </Text>
        </Animated.View>

        {/* Analysis */}
        {(analysis || keyHome || keyAway) ? (
          <Animated.View style={cardStyle(analysisAnim)}>
            <Text style={[styles.analysisLabel, { color: theme.textTertiary }]}>ANALYSIS</Text>
            <View style={[styles.analysisCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={styles.analysisBallWrap} pointerEvents="none">
                <Image source={BALL} style={styles.analysisBall} />
              </View>
              {(keyHome || keyAway) && (
                <Text style={[styles.keyLine, { color: theme.text }]}>
                  {keyHome ? <Text style={{ color: accent, fontWeight: '800' }}>{playerName(keyHome)}</Text> : null}
                  {keyHome ? ` (${teamAbbr(teamA)})` : ''}
                  {keyHome && keyAway ? ' · ' : ''}
                  {keyAway ? <Text style={{ color: accent, fontWeight: '800' }}>{playerName(keyAway)}</Text> : null}
                  {keyAway ? ` (${teamAbbr(teamB)})` : ''}
                  {' — the names deciding this.'}
                </Text>
              )}
              {analysis ? (
                <Text selectable style={[styles.analysisText, { color: theme.textSecondary }]}>{analysis}</Text>
              ) : null}
              {elapsed != null && (
                <View style={[styles.statRow, { borderTopColor: theme.border }]}>
                  <View style={[styles.statDot, { backgroundColor: accent }]} />
                  <Text style={[styles.stat, { color: theme.textTertiary }]}>Generated in {elapsed}s, entirely on-device</Text>
                </View>
              )}
            </View>
          </Animated.View>
        ) : null}

        <Text style={[styles.credit, { color: theme.textTertiary }]}>
          Fixtures & badges: TheSportsDB · Form: football-data.org{realSplit ? ' · Odds: Bzzoiro Sports' : ''} · AI: on-device (QVAC)
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 4 },

  verdict: { borderRadius: 24, borderWidth: 1, padding: 20, overflow: 'hidden' },
  verdictTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 14 },
  verdictSide: { flex: 1, maxWidth: 110, alignItems: 'center', gap: 7 },
  verdictName: { fontSize: 10, fontFamily: fonts.displayBold, textTransform: 'uppercase', letterSpacing: 0.3, textAlign: 'center' },
  verdictVs: { fontSize: 10, fontFamily: fonts.mono, fontWeight: '800', marginTop: 10 },
  verdictEyebrow: { textAlign: 'center', fontSize: 10, fontFamily: fonts.mono, fontWeight: '700', letterSpacing: 2, marginTop: 18, marginBottom: 8 },
  verdictHeadline: { fontSize: 26, fontFamily: fonts.displayBlack, lineHeight: 29, letterSpacing: -0.5, textAlign: 'center', marginBottom: 4 },
  mlsLine: { textAlign: 'center', fontSize: 11, fontFamily: fonts.bodySemiBold, marginBottom: 16 },
  mlsScore: { fontSize: 13, fontFamily: fonts.mono, fontWeight: '800', fontVariant: ['tabular-nums'] },
  outcomeRow: { flexDirection: 'row', gap: 8 },
  outcomeChip: { flex: 1, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 4, alignItems: 'center' },
  ocPct: { fontSize: 16, fontFamily: fonts.mono, fontWeight: '800', fontVariant: ['tabular-nums'] },
  ocLabel: { fontSize: 9, fontFamily: fonts.bodySemiBold, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 5 },
  oddsSource: { fontSize: 9.5, fontFamily: fonts.bodyMedium, textAlign: 'center', marginTop: 10 },

  analysisLabel: { fontSize: 9.5, fontFamily: fonts.mono, fontWeight: '700', letterSpacing: 1.5, marginTop: 14, marginBottom: 8, marginLeft: 2 },
  analysisCard: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 8, overflow: 'hidden' },
  analysisBallWrap: { position: 'absolute', right: -34, bottom: -34, width: 110, height: 110 },
  analysisBall: { width: 110, height: 110, opacity: 0.1 },
  keyLine: { fontSize: 11.5, lineHeight: 17 },
  analysisText: { fontSize: 12.5, lineHeight: 20 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, paddingTop: 10, borderTopWidth: 1 },
  statDot: { width: 4, height: 4, borderRadius: 2 },
  stat: { fontSize: 10.5, fontFamily: fonts.bodyMedium },

  credit: { textAlign: 'center', fontSize: 9.5, lineHeight: 14, marginTop: 16 },
});
