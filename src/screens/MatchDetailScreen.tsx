import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { getTheme } from '../theme';
import { fonts } from '../theme/fonts';
import { useTheme } from '../navigation/AppNavigator';
import ScreenHeader from '../components/ScreenHeader';
import Glow from '../components/Glow';
import { SkeletonMatchDetail } from '../components/Skeleton';
import TeamBadge from '../components/TeamBadge';
import { badgeUrl, teamAbbr, fmtMatchTime, isLive, isFinished, todayISO, type Fixture } from '../utils/fixtures';
import { fetchBothTeamForms, type TeamForm } from '../utils/teamStats';
import { fetchHeadToHead, fetchLineups, fetchEventExtra, fuzzyNameMatch, type H2HMatch, type MatchLineups, type EventExtra } from '../utils/bzzoiro';
import { getActiveBzKey, getActiveFdKey } from '../utils/storage';

const PITCH = require('../../assets/pitch.jpg');

// Bzzoiro's weather description is free-text ("cloudy", "clear", "light
// rain", ...) — mapped to a small icon rather than shown as a bare word.
const weatherEmoji = (description: string): string => {
  const d = description.toLowerCase();
  if (d.includes('storm') || d.includes('thunder')) return '⛈️';
  if (d.includes('snow')) return '❄️';
  if (d.includes('rain') || d.includes('drizzle')) return '🌧️';
  if (d.includes('cloud') || d.includes('overcast')) return '☁️';
  if (d.includes('clear') || d.includes('sun')) return '☀️';
  return '🌤️';
};

// The match-tap landing page — was a direct jump to Predictor ("quick
// predict"), which skipped straight past any of the context a fan
// actually wants before committing to a prediction. This sits between:
// tap a fixture on Matches → see real head-to-head/lineups/form here →
// "Predict This Match" continues into Predictor exactly as before.
export default function MatchDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const theme = getTheme(useTheme());
  const insets = useSafeAreaInsets();
  const accent = theme.accent;
  const fixture: Fixture = route.params?.fixture;

  const [formA, setFormA] = useState<TeamForm | null>(null);
  const [formB, setFormB] = useState<TeamForm | null>(null);
  const [h2h, setH2h] = useState<H2HMatch[] | null>(null);
  const [lineups, setLineups] = useState<MatchLineups | null>(null);
  const [eventExtra, setEventExtra] = useState<EventExtra | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!fixture) return;
    (async () => {
      const bzKey = await getActiveBzKey().catch(() => '');
      const fdKey = await getActiveFdKey().catch(() => '');
      const [[fA, fB], h2hResult] = await Promise.all([
        // Generous timeout — unlike Predictor, this screen has no pre-
        // inference urgency (a skeleton is already showing), and the tight
        // 3.5s default tuned for Predictor's critical path was cutting off
        // real Bzzoiro data before it arrived (verified live: Norway/
        // England/Spain/Belgium all had real recent results that came back
        // within 6-7s).
        fetchBothTeamForms(fixture.strHomeTeam, fixture.strAwayTeam, fdKey, bzKey, 7000).catch(() => [null, null] as [TeamForm | null, TeamForm | null]),
        bzKey ? fetchHeadToHead(bzKey, fixture.strHomeTeam, fixture.strAwayTeam).catch(() => []) : Promise.resolve([]),
      ]);
      if (!mountedRef.current) return;
      setFormA(fA); setFormB(fB); setH2h(h2hResult);
      // BUG FIX: this used to await lineups BEFORE setLoading(false) —
      // form/H2H sat fully resolved in state while the skeleton kept
      // showing for however long the separate lineups fetch took, so
      // "already-ready" data appeared to show up late for no reason.
      // Lineups now populate independently; its own section only renders
      // once `lineups` is set, so it needs no shared loading flag at all.
      setLoading(false);
      // Lineups/round/venue/weather need the SPECIFIC Bzzoiro event id —
      // only available when this exact fixture came from Bzzoiro in the
      // first place (idEvent is prefixed "bz-"), not for a
      // TheSportsDB-sourced one.
      if (bzKey && fixture.idEvent?.startsWith('bz-')) {
        const eventId = parseInt(fixture.idEvent.slice(3), 10);
        if (!isNaN(eventId)) {
          const [lu, extra] = await Promise.all([
            fetchLineups(bzKey, eventId).catch(() => null),
            fetchEventExtra(bzKey, eventId).catch(() => null),
          ]);
          if (mountedRef.current) { setLineups(lu); setEventExtra(extra); }
        }
      }
    })();
    return () => { mountedRef.current = false; };
  }, [fixture?.idEvent]);

  if (!fixture) {
    return (
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        <ScreenHeader title="Match" />
      </View>
    );
  }

  const predictThisMatch = () => navigation.navigate('Predictor', { fixtureId: fixture.idEvent });

  // Won/draws/won tally from TODAY's home team's perspective — each h2h
  // match is an old fixture where either side could have been "home", so
  // matches get re-oriented against fixture.strHomeTeam before counting,
  // rather than just tallying literal home/away scorelines.
  const h2hSummary = (() => {
    if (!h2h || h2h.length === 0) return null;
    let homeWins = 0, draws = 0, awayWins = 0;
    for (const m of h2h) {
      const oldHomeIsFixtureHome = fuzzyNameMatch(m.homeTeam, fixture.strHomeTeam);
      const oldHomeIsFixtureAway = fuzzyNameMatch(m.homeTeam, fixture.strAwayTeam);
      if (!oldHomeIsFixtureHome && !oldHomeIsFixtureAway) continue;
      const fixtureHomeScore = oldHomeIsFixtureHome ? m.homeScore : m.awayScore;
      const fixtureAwayScore = oldHomeIsFixtureHome ? m.awayScore : m.homeScore;
      if (fixtureHomeScore > fixtureAwayScore) homeWins++;
      else if (fixtureHomeScore < fixtureAwayScore) awayWins++;
      else draws++;
    }
    const total = homeWins + draws + awayWins;
    return total > 0 ? { homeWins, draws, awayWins, total } : null;
  })();

  const FormRow = ({ form, teamName }: { form: TeamForm | null; teamName: string }) => (
    <View style={styles.formRow}>
      <Text style={[styles.formTeamName, { color: theme.text }]} numberOfLines={1}>{teamName}</Text>
      <View style={styles.formDots}>
        {form && form.form.length > 0 ? form.form.map((r, i) => (
          <View
            key={i}
            style={[
              styles.formDot,
              r === 'W' ? { backgroundColor: accent } : r === 'L' ? { backgroundColor: theme.error } : { backgroundColor: theme.textTertiary },
            ]}
          >
            <Text style={styles.formDotText}>{r}</Text>
          </View>
        )) : (
          <Text style={[styles.formEmpty, { color: theme.textTertiary }]}>No recent form found</Text>
        )}
      </View>
    </View>
  );

  const LineupCol = ({ team }: { team: MatchLineups['home'] }) => (
    <View style={styles.lineupCol}>
      <Text style={[styles.lineupTeam, { color: theme.text }]} numberOfLines={1}>{team?.teamName}</Text>
      {team?.formation ? <Text style={[styles.lineupFormation, { color: accent }]}>{team.formation}</Text> : null}
      {(team?.players ?? []).map((p, i) => (
        <Text key={i} style={[styles.lineupPlayer, { color: theme.textSecondary }]} numberOfLines={1}>
          {p.jerseyNumber != null ? `${p.jerseyNumber} · ` : ''}{p.name}
        </Text>
      ))}
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ScreenHeader title={`${fixture.strHomeTeam} vs ${fixture.strAwayTeam}`} subtitle={fixture.strLeague} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>

        {/* Hero — soft pitch photo behind the card only (not full-bleed like
            Home's stadium backdrop), muted under a tinted scrim so team
            names/scores stay legible on top. */}
        <Animated.View style={[styles.hero, { borderColor: theme.border, opacity: fadeAnim }]}>
          <Image source={PITCH} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.card, opacity: 0.82 }]} />
          <Glow color={accent} opacity={0.14} anchor="tr" />
          <View style={styles.heroTeams}>
            <View style={styles.heroTeamCol}>
              <TeamBadge url={badgeUrl(fixture.strHomeTeamBadge)} name={fixture.strHomeTeam} abbr={teamAbbr(fixture.strHomeTeam)} size={44} />
              <Text style={[styles.heroTeamName, { color: theme.text }]} numberOfLines={1}>{fixture.strHomeTeam}</Text>
            </View>
            <View style={styles.heroMid}>
              {fixture.intHomeScore != null ? (
                <Text style={[styles.heroScore, { color: theme.text }]}>{fixture.intHomeScore}–{fixture.intAwayScore}</Text>
              ) : (
                <Text style={[styles.heroVs, { color: theme.textTertiary }]}>VS</Text>
              )}
              <Text style={[styles.heroTime, { color: theme.textSecondary }]}>
                {isLive(fixture) ? 'LIVE' : isFinished(fixture) ? 'FULL TIME'
                  : fixture.dateEvent === todayISO() ? `Today · ${fmtMatchTime(fixture.strTime)}`
                  : fixture.dateEvent ? `${new Date(fixture.dateEvent).toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${fmtMatchTime(fixture.strTime)}` : ''}
              </Text>
            </View>
            <View style={styles.heroTeamCol}>
              <TeamBadge url={badgeUrl(fixture.strAwayTeamBadge)} name={fixture.strAwayTeam} abbr={teamAbbr(fixture.strAwayTeam)} size={44} />
              <Text style={[styles.heroTeamName, { color: theme.text }]} numberOfLines={1}>{fixture.strAwayTeam}</Text>
            </View>
          </View>
          {(eventExtra?.roundName || eventExtra?.venueName || eventExtra?.weather) && (
            <Text style={[styles.heroMeta, { color: theme.textTertiary }]} numberOfLines={1}>
              {[
                eventExtra?.roundName,
                eventExtra?.venueName ? (eventExtra.venueCity ? `${eventExtra.venueName}, ${eventExtra.venueCity}` : eventExtra.venueName) : null,
                eventExtra?.weather ? `${weatherEmoji(eventExtra.weather.description)} ${eventExtra.weather.temperatureC != null ? `${Math.round(eventExtra.weather.temperatureC)}°C` : eventExtra.weather.description}` : null,
              ].filter(Boolean).join(' · ')}
            </Text>
          )}
        </Animated.View>

        {loading ? <SkeletonMatchDetail /> : (
          <>
            {/* Recent form */}
            <Text style={[styles.sectionLabel, { color: theme.textTertiary }]}>RECENT FORM</Text>
            <View style={[styles.sectionCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <FormRow form={formA} teamName={fixture.strHomeTeam} />
              <View style={[styles.divider, { backgroundColor: theme.border }]} />
              <FormRow form={formB} teamName={fixture.strAwayTeam} />
            </View>

            {/* Head to head */}
            <Text style={[styles.sectionLabel, { color: theme.textTertiary }]}>HEAD-TO-HEAD</Text>
            <View style={[styles.sectionCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              {h2hSummary && (
                <View style={styles.h2hSummary}>
                  <View style={styles.h2hSummaryRow}>
                    <View style={styles.h2hSummaryCol}>
                      <Text style={[styles.h2hSummaryCount, { color: accent }]}>{h2hSummary.homeWins}</Text>
                      <Text style={[styles.h2hSummaryLabel, { color: theme.textTertiary }]} numberOfLines={1}>{fixture.strHomeTeam} won</Text>
                    </View>
                    <View style={styles.h2hSummaryCol}>
                      <Text style={[styles.h2hSummaryCount, { color: theme.textSecondary }]}>{h2hSummary.draws}</Text>
                      <Text style={[styles.h2hSummaryLabel, { color: theme.textTertiary }]}>Draws</Text>
                    </View>
                    <View style={styles.h2hSummaryCol}>
                      <Text style={[styles.h2hSummaryCount, { color: theme.error }]}>{h2hSummary.awayWins}</Text>
                      <Text style={[styles.h2hSummaryLabel, { color: theme.textTertiary }]} numberOfLines={1}>{fixture.strAwayTeam} won</Text>
                    </View>
                  </View>
                  <View style={[styles.h2hSummaryBar, { backgroundColor: theme.border }]}>
                    <View style={{ flex: h2hSummary.homeWins, backgroundColor: accent }} />
                    <View style={{ flex: h2hSummary.draws, backgroundColor: theme.textTertiary }} />
                    <View style={{ flex: h2hSummary.awayWins, backgroundColor: theme.error }} />
                  </View>
                  <View style={[styles.divider, { backgroundColor: theme.border }]} />
                </View>
              )}
              {!h2h ? (
                <Text style={[styles.emptyText, { color: theme.textTertiary }]}>Not available for this match.</Text>
              ) : h2h.length === 0 ? (
                <Text style={[styles.emptyText, { color: theme.textTertiary }]}>No recent meetings found.</Text>
              ) : (
                h2h.map((m, i) => (
                  <View key={i} style={[styles.h2hRow, i > 0 ? { borderTopWidth: 1, borderTopColor: theme.border } : null]}>
                    <Text style={[styles.h2hDate, { color: theme.textTertiary }]}>{m.date}</Text>
                    <Text style={[styles.h2hScore, { color: theme.text }]} numberOfLines={1}>
                      {m.homeTeam} <Text style={{ fontFamily: fonts.mono, color: accent }}>{m.homeScore}-{m.awayScore}</Text> {m.awayTeam}
                    </Text>
                  </View>
                ))
              )}
            </View>

            {/* Lineups — honest about predicted vs confirmed, since Bzzoiro
                serves AI-guessed probable XIs days ahead of a real team sheet */}
            {lineups && lineups.status !== 'unavailable' && (
              <>
                <View style={styles.lineupHeader}>
                  <Text style={[styles.sectionLabel, { color: theme.textTertiary }]}>LINEUPS</Text>
                  <View style={[styles.lineupBadge, { backgroundColor: lineups.status === 'confirmed' ? accent + '22' : theme.cardHot }]}>
                    <Text style={[styles.lineupBadgeText, { color: lineups.status === 'confirmed' ? accent : theme.textSecondary }]}>
                      {lineups.status === 'confirmed' ? 'CONFIRMED' : `PREDICTED${lineups.confidence != null ? ` · ${Math.round(lineups.confidence * 100)}%` : ''}`}
                    </Text>
                  </View>
                </View>
                <View style={[styles.sectionCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <View style={styles.lineupRow}>
                    <LineupCol team={lineups.home} />
                    <View style={[styles.lineupSep, { backgroundColor: theme.border }]} />
                    <LineupCol team={lineups.away} />
                  </View>
                </View>
              </>
            )}
          </>
        )}

        <View style={{ height: 8 }} />
      </ScrollView>

      <View style={[styles.ctaWrap, { backgroundColor: theme.background, paddingBottom: Math.max(insets.bottom, 14) }]}>
        <TouchableOpacity style={[styles.ctaBtn, { backgroundColor: accent }]} onPress={predictThisMatch} activeOpacity={0.85}>
          <Text style={[styles.ctaBtnText, { color: theme.accentFg }]}>Predict This Match →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 4 },

  hero: { borderRadius: 20, borderWidth: 1, padding: 18, overflow: 'hidden', marginBottom: 20 },
  heroTeams: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroTeamCol: { flex: 1, alignItems: 'center', gap: 8 },
  heroTeamName: { fontSize: 12.5, fontFamily: fonts.displayExtraBold, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.3 },
  heroMid: { alignItems: 'center', gap: 4, paddingHorizontal: 8 },
  heroVs: { fontSize: 16, fontFamily: fonts.displayBlack },
  heroScore: { fontSize: 30, fontFamily: fonts.displayBlack, fontVariant: ['tabular-nums'] },
  heroTime: { fontSize: 11, fontFamily: fonts.bodyMedium },
  heroMeta: { fontSize: 10.5, fontFamily: fonts.bodyMedium, textAlign: 'center', marginTop: 14 },

  sectionLabel: { fontSize: 10, fontFamily: fonts.mono, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8, marginTop: 4 },
  sectionCard: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 20 },

  formRow: { gap: 8 },
  formTeamName: { fontSize: 13, fontFamily: fonts.bodySemiBold },
  formDots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  formDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  formDotText: { fontSize: 10.5, fontFamily: fonts.displayExtraBold, color: '#0b0b0b' },
  formEmpty: { fontSize: 12, fontFamily: fonts.bodyMedium },
  divider: { height: 1, marginVertical: 12 },

  emptyText: { fontSize: 12.5, fontFamily: fonts.bodyMedium, textAlign: 'center', paddingVertical: 6 },
  h2hRow: { paddingVertical: 10, gap: 3 },
  h2hDate: { fontSize: 10, fontFamily: fonts.mono },
  h2hScore: { fontSize: 13, fontFamily: fonts.bodySemiBold },

  h2hSummary: { marginBottom: 4 },
  h2hSummaryRow: { flexDirection: 'row', marginBottom: 10 },
  h2hSummaryCol: { flex: 1, alignItems: 'center', gap: 3 },
  h2hSummaryCount: { fontSize: 22, fontFamily: fonts.displayBlack },
  h2hSummaryLabel: { fontSize: 10, fontFamily: fonts.mono, fontWeight: '700', letterSpacing: 0.3, textAlign: 'center' },
  h2hSummaryBar: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden' },

  lineupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lineupBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 8 },
  lineupBadgeText: { fontSize: 9.5, fontFamily: fonts.mono, fontWeight: '700', letterSpacing: 0.4 },
  lineupRow: { flexDirection: 'row' },
  lineupCol: { flex: 1, gap: 3 },
  lineupSep: { width: 1, marginHorizontal: 12 },
  lineupTeam: { fontSize: 12.5, fontFamily: fonts.displayExtraBold, marginBottom: 2 },
  lineupFormation: { fontSize: 11, fontFamily: fonts.mono, fontWeight: '700', marginBottom: 6 },
  lineupPlayer: { fontSize: 12, fontFamily: fonts.bodyMedium, lineHeight: 18 },

  ctaWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 10, paddingHorizontal: 16 },
  ctaBtn: { borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  ctaBtnText: { fontSize: 15, fontFamily: fonts.displayExtraBold },
});
