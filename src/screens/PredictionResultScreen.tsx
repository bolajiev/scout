import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Animated, TouchableOpacity, Share } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import { getTheme } from '../theme';
import { fonts } from '../theme/fonts';
import { useTheme } from '../navigation/AppNavigator';
import ScreenHeader from '../components/ScreenHeader';
import Glow from '../components/Glow';
import TeamBadge from '../components/TeamBadge';
import { IconShare } from '../components/Icons';
import { teamAbbr } from '../utils/fixtures';

// The prediction result on its own page — pushed over the tabs when a
// prediction completes, back button returns to the Predictor setup.
// Verdict + analysis only; no action buttons by design.
//
// The 3-way odds used to come from Bzzoiro's cloud ML model when a match
// resolved to a known event there — genuinely real numbers, but computed
// by a remote service, which sat oddly inside an app whose whole pitch is
// 100% on-device AI. Removed: the on-device model now outputs its own
// HOME WIN / DRAW / AWAY WIN estimate directly, reasoning over the same
// real recent-form data already in its prompt — still just a reasoning
// model's own estimate rather than true statistics, but computed entirely
// on-device, which is the point.

function confidenceParts(raw: string): { pct: number | null } {
  const m = (raw ?? '').match(/(\d{1,3})/);
  let pct = m ? Math.min(95, Math.max(5, parseInt(m[1], 10))) : null;
  if (pct == null) {
    const w = (raw ?? '').toLowerCase();
    pct = w.includes('high') ? 80 : w.includes('med') ? 62 : w.includes('low') ? 45 : null;
  }
  return { pct };
}

// Prefers the model's own HOME WIN / DRAW / AWAY WIN numbers — small
// on-device models rarely land on exactly 100 total, so these are
// normalized proportionally rather than trusted verbatim. Falls back to
// the old confidence-derived split only if the model didn't produce
// usable numbers for all three fields (older sessions resumed from
// history, or a model that didn't follow the format).
function outcomeSplit(
  homeRaw: string, drawRaw: string, awayRaw: string,
  confRaw: string, winnerIsDraw: boolean,
): { home: number; draw: number; away: number } {
  const num = (s: string) => {
    const m = (s ?? '').match(/(\d{1,3}(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  };
  const h = num(homeRaw), d = num(drawRaw), a = num(awayRaw);
  if (h != null && d != null && a != null && h + d + a > 0) {
    const total = h + d + a;
    const home = Math.round((h / total) * 100);
    const draw = Math.round((d / total) * 100);
    return { home, draw, away: 100 - home - draw };
  }
  const pct = confidenceParts(confRaw).pct ?? 55;
  const rem = 100 - pct;
  if (winnerIsDraw) {
    const side = Math.round(rem / 2);
    return { home: side, draw: pct, away: rem - side };
  }
  const draw = Math.round(rem * 0.45);
  return { home: pct, draw, away: rem - draw };
}

// KEY HOME/AWAY come back as "Name — why he decides this match" — splitting
// out the reason too (previously discarded, only the bare name showed) so
// the pick reads as a justified call instead of a name dropped with no
// grounding.
function splitPlayerClause(s: string): { name: string; reason: string } {
  const parts = (s ?? '').split(/\s[—–-]\s|,\s|\s\(/);
  return { name: (parts[0] ?? '').trim(), reason: parts.slice(1).join(' ').replace(/\)$/, '').trim() };
}

export default function PredictionResultScreen() {
  const route = useRoute<any>();
  const theme = getTheme(useTheme());
  const insets = useSafeAreaInsets();
  const accent = theme.accent;

  const {
    teamA = '', teamB = '', winner = '', score = '', confidence = '',
    homeWin = '', draw: drawPct = '', awayWin = '',
    keyHome = '', keyAway = '', analysis = '', elapsed,
    homeRating = null, awayRating = null, device, modelName,
  } = route.params ?? {};

  const winnerIsDraw = /draw/i.test(winner);
  const winnerIsA = !winnerIsDraw && winner === teamA;
  const split = outcomeSplit(homeWin, drawPct, awayWin, confidence, winnerIsDraw);

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

  const share = () => {
    const lines = [
      `${teamA} vs ${teamB}`,
      winner ? `Scout's call: ${winner}${score ? ` (${score})` : ''}` : null,
      confidence ? `Confidence: ${confidence}` : null,
      'Predicted 100% on-device with Scout.',
    ].filter(Boolean);
    Share.share({ message: lines.join('\n') }).catch(() => {});
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ScreenHeader
        title={`${teamA} vs ${teamB}`}
        subtitle="Scout's call · on-device"
        rightSlot={
          <TouchableOpacity onPress={share} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <IconShare size={20} color={theme.textSecondary} />
          </TouchableOpacity>
        }
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>

        {/* Verdict */}
        <Animated.View style={[styles.verdict, { backgroundColor: theme.card, borderColor: theme.border }, cardStyle(verdictAnim)]}>
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
          {score ? (
            <Text style={[styles.mlsLine, { color: theme.textSecondary }]}>
              Most likely score <Text style={[styles.mlsScore, { color: theme.text }]}>{score}</Text>
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
            Scout's own estimate — not a bookmaker's real odds
          </Text>
        </Animated.View>

        {/* Analysis — reasoning first, then the key-player call as a
            conclusion drawn from it (was the other way round, reading as
            an unexplained assertion before you'd seen any of the
            reasoning behind it), each with its own small label so neither
            looks like a stray sentence tacked onto the other's box. */}
        {(analysis || keyHome || keyAway) ? (
          <Animated.View style={cardStyle(analysisAnim)}>
            <Text style={[styles.analysisLabel, { color: theme.textTertiary }]}>ANALYSIS</Text>
            <View style={[styles.analysisCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              {analysis ? (
                <Text selectable style={[styles.analysisText, { color: theme.textSecondary }]}>{analysis}</Text>
              ) : null}
              {(keyHome || keyAway) && (
                <View style={[styles.keySection, analysis ? { borderTopColor: theme.border, borderTopWidth: 1 } : null]}>
                  <Text style={[styles.keyLabel, { color: theme.textTertiary }]}>PLAYERS TO WATCH</Text>
                  {/* BUG FIX: was one joined line ("Name (FRA) · Name (MOR)")
                      that read as two picks smooshed together rather than
                      two distinct calls — each player now gets its own row,
                      plus the model's actual reasoning clause (previously
                      discarded by playerName's split) instead of a bare
                      name with no justification. */}
                  {/* Rating badge is the real Bzzoiro number, passed straight
                      through from the fetch — not re-parsed from the
                      model's own text, so it can't drift from what the
                      data source actually says regardless of phrasing. */}
                  {keyHome ? (() => {
                    const { name, reason } = splitPlayerClause(keyHome);
                    return (
                      <View style={styles.keyRow}>
                        <View style={styles.keyRowTop}>
                          <Text style={[styles.keyRowName, { color: theme.text }]}>
                            <Text style={{ color: accent, fontWeight: '800' }}>{name}</Text> ({teamAbbr(teamA)})
                          </Text>
                          {homeRating != null && (
                            <View style={[styles.ratingBadge, { backgroundColor: accent + '18' }]}>
                              <Text style={[styles.ratingBadgeText, { color: accent }]}>{homeRating}</Text>
                            </View>
                          )}
                        </View>
                        {reason ? <Text style={[styles.keyRowReason, { color: theme.textSecondary }]}>{reason}</Text> : null}
                      </View>
                    );
                  })() : null}
                  {keyAway ? (() => {
                    const { name, reason } = splitPlayerClause(keyAway);
                    return (
                      <View style={styles.keyRow}>
                        <View style={styles.keyRowTop}>
                          <Text style={[styles.keyRowName, { color: theme.text }]}>
                            <Text style={{ color: accent, fontWeight: '800' }}>{name}</Text> ({teamAbbr(teamB)})
                          </Text>
                          {awayRating != null && (
                            <View style={[styles.ratingBadge, { backgroundColor: accent + '18' }]}>
                              <Text style={[styles.ratingBadgeText, { color: accent }]}>{awayRating}</Text>
                            </View>
                          )}
                        </View>
                        {reason ? <Text style={[styles.keyRowReason, { color: theme.textSecondary }]}>{reason}</Text> : null}
                      </View>
                    );
                  })() : null}
                </View>
              )}
              {elapsed != null && (
                <View style={[styles.statRow, { borderTopColor: theme.border }]}>
                  <View style={[styles.statDot, { backgroundColor: accent }]} />
                  <Text style={[styles.stat, { color: theme.textTertiary }]}>
                    Generated in {elapsed}s, entirely on-device{device ? ` (${String(device).toUpperCase()})` : ''}{modelName ? ` · ${modelName}` : ''}
                  </Text>
                </View>
              )}
            </View>
          </Animated.View>
        ) : null}

        <Text style={[styles.credit, { color: theme.textTertiary }]}>
          Fixtures & badges: TheSportsDB · Form & player ratings: football-data.org, Bzzoiro Sports · AI: on-device (QVAC)
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
  analysisCard: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 8 },
  keySection: { paddingTop: 10, marginTop: 2, gap: 8 },
  keyLabel: { fontSize: 9.5, fontFamily: fonts.mono, fontWeight: '700', letterSpacing: 1.2 },
  keyRow: { gap: 2 },
  keyRowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  keyRowName: { fontSize: 13, lineHeight: 18 },
  keyRowReason: { fontSize: 12, lineHeight: 17 },
  ratingBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  ratingBadgeText: { fontSize: 10.5, fontFamily: fonts.mono, fontWeight: '800' },
  analysisText: { fontSize: 12.5, lineHeight: 20 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, paddingTop: 10, borderTopWidth: 1 },
  statDot: { width: 4, height: 4, borderRadius: 2 },
  stat: { fontSize: 10.5, fontFamily: fonts.bodyMedium },

  credit: { textAlign: 'center', fontSize: 9.5, lineHeight: 14, marginTop: 16 },
});
